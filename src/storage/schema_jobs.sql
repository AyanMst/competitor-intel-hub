-- One-time setup: run this in the Supabase SQL Editor for this project.
-- Async Job Queue on top of the existing `reports` /
-- `competitors` tables. Purely additive — does not alter any existing table.
--
-- Fixes the critical failure point identified in the architecture review:
-- `/analyze` and `/analyze-video` used to run Whisper + all LLM calls inline
-- inside the HTTP request, with no protection against a client (or a proxy
-- timeout-triggered retry) resubmitting the same video mid-flight — each
-- resubmission re-ran the full pipeline and re-billed OpenAI from scratch.
--
-- `analysis_jobs` is the queue table the two endpoints now enqueue into
-- (see api.py) instead of processing inline. A background worker (see src/workers/job_worker.py) drains rows with status = 'pending'.

create table if not exists public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  -- Nullable because require_auth is not guaranteed to be enforced on every
  -- deployment yet; see the coalesce() in the partial unique index below for
  -- how dedup still holds even when this is null.
  user_id uuid references auth.users(id) on delete set null,
  source_type text not null check (source_type in ('upload', 'youtube')),
  -- youtube: the full video URL (the worker needs more than just the video_id
  -- to run the existing scraper pipeline). upload: the durable on-disk path
  -- the file was persisted to by POST /analyze-video (see
  -- config.yaml -> directories.pending_uploads), since the temp file used by
  -- the old inline flow no longer survives past the request.
  source_ref text not null,
  -- Required input the worker needs to run `resolve_competitor_and_changes`
  -- / `process_youtube_url`; not in the original column list but has no
  -- other home once processing is deferred out of the request.
  competitor_name text not null,
  -- the async job queueaddition: the upload's original filename (e.g.
  -- "acme-demo.mp4"), captured by POST /analyze-video at enqueue time.
  -- source_ref for uploads is the content-hashed on-disk path, which is a
  -- meaningless label for the saved report/reports list — this is what the
  -- worker uses instead as the report's `filename`. Null for youtube jobs.
  original_filename text,
  -- youtube: the extracted video_id (YouTubeScraper.extract_video_id).
  -- upload: sha256 hex digest of the uploaded file's bytes.
  dedup_key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'transcribing', 'analyzing', 'completed', 'failed')),
  current_step text,
  error_message text,
  result_report_id uuid references public.reports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- the async job queue: `original_filename` was added after this table was
-- first created (see comment above). `add column if not exists` makes
-- re-running this whole script safe on a database where `analysis_jobs`
-- already exists without it, instead of requiring a separate migration file.
alter table public.analysis_jobs
  add column if not exists original_filename text;

-- THE retry-storm guard: at most one non-'failed' job may exist per
-- (user_id, dedup_key) at a time. A failed job does not hold the slot, so a
-- legitimate retry after a real failure can still enqueue a fresh job.
--
-- user_id is wrapped in coalesce() because Postgres unique indexes treat
-- NULL as distinct from every other NULL — without it, two anonymous
-- (user_id IS NULL) requests for the same dedup_key would NOT collide, and
-- the whole guard would silently stop working the moment auth is optional.
create unique index if not exists analysis_jobs_dedup_active_idx
  on public.analysis_jobs (
    coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    dedup_key
  )
  where status <> 'failed';

-- Lookup path for the worker: find the oldest queued job to pick up.
create index if not exists analysis_jobs_status_created_at_idx
  on public.analysis_jobs (status, created_at);

create index if not exists analysis_jobs_user_id_idx
  on public.analysis_jobs (user_id);

-- Keeps `updated_at` accurate across every status transition
-- (pending -> transcribing -> analyzing -> completed/failed) without relying
-- on the worker to remember to set it on every write.
create or replace function public.set_analysis_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists analysis_jobs_set_updated_at on public.analysis_jobs;
create trigger analysis_jobs_set_updated_at
  before update on public.analysis_jobs
  for each row
  execute function public.set_analysis_jobs_updated_at();

-- The backend talks to this table using the service_role key, which
-- bypasses Row Level Security entirely, so none of the above required RLS.
--
-- the async job queuechanges that, though: the frontend now subscribes
-- directly to this table via Supabase Realtime (anon/authenticated key, not
-- service_role) to drive the live progress UI, instead of HTTP polling. Two
-- things are required for that subscription to receive anything at all —
-- without either, it fails silently (zero events, no error):
--
-- 1. RLS + a SELECT policy, since Realtime's `postgres_changes` filters each
--    change through the subscriber's RLS as if it were a SELECT. Scoped to
--    "your own jobs" via user_id = auth.uid(), matching how every job is
--    created with the requester's id (see api.py's `create_or_get_job` call).
-- 2. The table added to the `supabase_realtime` publication — new tables are
--    NOT in it by default.
alter table public.analysis_jobs enable row level security;

drop policy if exists "Users can view their own analysis jobs" on public.analysis_jobs;
create policy "Users can view their own analysis jobs"
  on public.analysis_jobs
  for select
  using (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'analysis_jobs'
  ) then
    alter publication supabase_realtime add table public.analysis_jobs;
  end if;
end $$;
