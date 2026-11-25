-- One-time setup: run this in the Supabase SQL Editor for this project.
--
-- DATA ISOLATION
--
-- Problem: `reports`, `competitors`, `tracked_channels`, `processed_videos`
-- and `report_embeddings` had no `user_id` column and no Row Level Security.
-- The backend talks to Supabase exclusively with the service_role key, which
-- BYPASSES RLS entirely — so RLS alone was never going to be the only
-- control here. The real fix is two-layered, both shipped together:
--   1. Every table gets a `user_id` column, and every backend read/write
--      (see api.py / src/storage/*_repository.py / src/services/analysis_service.py)
--      is now scoped by the authenticated caller's id. This is the primary
--      defense — it is enforced even though the DB connection is service_role.
--   2. RLS + strict per-row policies are enabled anyway, as defense-in-depth
--      for any current or future access path that does NOT go through
--      service_role — e.g. the existing `analysis_jobs` Supabase Realtime
--      subscription (schema_jobs.sql) which authenticates as the browser's
--      own session, or any future "query Supabase directly from the
--      frontend" feature. Without this, a bug that ever exposed the anon/
--      authenticated key path would leak every tenant's data.
--
-- Safe to re-run: every statement is idempotent (`if not exists` / `drop ...
-- if exists` before `create`).
--
-- ============================================================================
-- STEP 0 — PRE-FLIGHT: back-fill or quarantine pre-multi-tenant rows
-- ============================================================================
-- Every row created before this migration has `user_id = NULL`. Once RLS
-- policies below require `auth.uid() = user_id`, NULL-owned rows become
-- invisible to every authenticated user (service_role can still see them).
-- Decide how to handle existing data BEFORE running this file in production:
--
--   a) Development / no real tenants yet: do nothing — orphaned rows just
--      become invisible to end users, and you can delete them later.
--   b) You want to assign all existing data to one real account (e.g. your
--      own), uncomment and fill in the UUID below, then run once:
--
-- -- do $$
-- -- declare
-- --   owner_id uuid := '00000000-0000-0000-0000-000000000000'; -- <-- replace
-- -- begin
-- --   update public.reports            set user_id = owner_id where user_id is null;
-- --   update public.competitors        set user_id = owner_id where user_id is null;
-- --   update public.tracked_channels   set user_id = owner_id where user_id is null;
-- --   update public.processed_videos   set user_id = owner_id where user_id is null;
-- --   update public.report_embeddings  set user_id = owner_id where user_id is null;
-- -- end $$;

-- ============================================================================
-- STEP 1 — ADD user_id TO EVERY TENANT-OWNED TABLE
-- ============================================================================

alter table public.reports
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.competitors
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.tracked_channels
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.processed_videos
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.report_embeddings
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- analysis_jobs already has user_id (schema_jobs.sql) — statement below is a
-- no-op there, kept only so this file is a complete/self-contained reference
-- of every tenant-owned table.
alter table public.analysis_jobs
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists reports_user_id_idx on public.reports (user_id);
create index if not exists competitors_user_id_idx on public.competitors (user_id);
create index if not exists tracked_channels_user_id_idx on public.tracked_channels (user_id);
create index if not exists processed_videos_user_id_idx on public.processed_videos (user_id);
create index if not exists report_embeddings_user_id_idx on public.report_embeddings (user_id);

-- ============================================================================
-- STEP 2 — FIX CROSS-TENANT UNIQUENESS BUGS
-- ============================================================================
-- These are functional data-isolation bugs, not just missing RLS: both
-- constraints below were GLOBAL, so the second tenant to touch the same
-- YouTube channel/video would silently be handed back (and start sharing)
-- the FIRST tenant's row.

-- `competitors.name` lookups (get_or_create_competitor) are now scoped by
-- (user_id, lower(name)) in the app layer — enforce it at the DB level too,
-- so two tenants can each have their own "Acme Corp" competitor record
-- without colliding.
--
-- The original global uniqueness was backed by a UNIQUE CONSTRAINT (not a
-- bare index), so it must be dropped via `drop constraint` — `drop index`
-- fails with "cannot drop index ... because constraint ... requires it".
alter table public.competitors drop constraint if exists competitors_name_key;
create unique index if not exists competitors_user_id_name_idx
  on public.competitors (user_id, lower(name));

-- `tracked_channels.channel_url` was globally unique. Scope to per-tenant so
-- two tenants can each independently track the same public YouTube channel.
alter table public.tracked_channels drop constraint if exists tracked_channels_channel_url_key;
create unique index if not exists tracked_channels_user_id_channel_url_idx
  on public.tracked_channels (user_id, channel_url);

-- `processed_videos.video_id` was globally unique, which meant once ANY
-- tenant's channel processed a given video, every OTHER tenant tracking the
-- same channel would have it silently skipped forever (never generating
-- their own report). Idempotency must be scoped per tracked_channel, not
-- globally per video.
alter table public.processed_videos drop constraint if exists processed_videos_video_id_key;
create unique index if not exists processed_videos_channel_video_idx
  on public.processed_videos (tracked_channel_id, video_id);

-- ============================================================================
-- STEP 3 — UPDATE THE PGVECTOR SEARCH RPC TO ENFORCE TENANT SCOPING
-- ============================================================================
-- `match_report_embeddings` (schema_search.sql) previously searched across
-- every tenant's claims. Adds a required `current_user_id` filter, matching
-- the requested `search_reports`-style contract. Function
-- name is left as `match_report_embeddings` to match the existing RPC call
-- in src/storage/embeddings_repository.py — only the signature/body changed.
drop function if exists public.match_report_embeddings(vector, int, timestamptz, uuid, text);

create or replace function public.match_report_embeddings(
  query_embedding vector(1536),
  current_user_id uuid,
  match_count int default 10,
  since_date timestamptz default null,
  filter_competitor_id uuid default null,
  filter_pillar text default null
)
returns table (
  id uuid,
  report_id uuid,
  competitor_id uuid,
  competitor_name text,
  pillar text,
  claim_text text,
  claim_timestamp double precision,
  report_created_at timestamptz,
  similarity float
)
language sql stable
as $$
  select
    e.id,
    e.report_id,
    e.competitor_id,
    c.name as competitor_name,
    e.pillar,
    e.claim_text,
    e.claim_timestamp,
    e.report_created_at,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.report_embeddings e
  left join public.competitors c on c.id = e.competitor_id
  where e.user_id = current_user_id
    and (since_date is null or e.report_created_at >= since_date)
    and (filter_competitor_id is null or e.competitor_id = filter_competitor_id)
    and (filter_pillar is null or e.pillar = filter_pillar)
  order by e.embedding <=> query_embedding
  limit match_count;
$$;

-- ============================================================================
-- STEP 4 — ENABLE ROW LEVEL SECURITY + STRICT POLICIES
-- ============================================================================
-- service_role (used by api.py / job_worker.py / channel_monitor.py) bypasses
-- RLS regardless of these policies — they exist for any anon/authenticated-
-- key access path (Realtime subscriptions, future direct-from-browser reads).

-- ---- reports ----------------------------------------------------------
alter table public.reports enable row level security;

drop policy if exists "reports_select_own" on public.reports;
create policy "reports_select_own" on public.reports
  for select using (auth.uid() = user_id);

drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own" on public.reports
  for insert with check (auth.uid() = user_id);

drop policy if exists "reports_update_own" on public.reports;
create policy "reports_update_own" on public.reports
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "reports_delete_own" on public.reports;
create policy "reports_delete_own" on public.reports
  for delete using (auth.uid() = user_id);

-- ---- competitors --------------------------------------------------------
alter table public.competitors enable row level security;

drop policy if exists "competitors_select_own" on public.competitors;
create policy "competitors_select_own" on public.competitors
  for select using (auth.uid() = user_id);

drop policy if exists "competitors_insert_own" on public.competitors;
create policy "competitors_insert_own" on public.competitors
  for insert with check (auth.uid() = user_id);

drop policy if exists "competitors_update_own" on public.competitors;
create policy "competitors_update_own" on public.competitors
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "competitors_delete_own" on public.competitors;
create policy "competitors_delete_own" on public.competitors
  for delete using (auth.uid() = user_id);

-- ---- tracked_channels -----------------------------------------------------
alter table public.tracked_channels enable row level security;

drop policy if exists "tracked_channels_select_own" on public.tracked_channels;
create policy "tracked_channels_select_own" on public.tracked_channels
  for select using (auth.uid() = user_id);

drop policy if exists "tracked_channels_insert_own" on public.tracked_channels;
create policy "tracked_channels_insert_own" on public.tracked_channels
  for insert with check (auth.uid() = user_id);

drop policy if exists "tracked_channels_update_own" on public.tracked_channels;
create policy "tracked_channels_update_own" on public.tracked_channels
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "tracked_channels_delete_own" on public.tracked_channels;
create policy "tracked_channels_delete_own" on public.tracked_channels
  for delete using (auth.uid() = user_id);

-- ---- processed_videos ----------------------------------------------------
alter table public.processed_videos enable row level security;

drop policy if exists "processed_videos_select_own" on public.processed_videos;
create policy "processed_videos_select_own" on public.processed_videos
  for select using (auth.uid() = user_id);

drop policy if exists "processed_videos_insert_own" on public.processed_videos;
create policy "processed_videos_insert_own" on public.processed_videos
  for insert with check (auth.uid() = user_id);

drop policy if exists "processed_videos_update_own" on public.processed_videos;
create policy "processed_videos_update_own" on public.processed_videos
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "processed_videos_delete_own" on public.processed_videos;
create policy "processed_videos_delete_own" on public.processed_videos
  for delete using (auth.uid() = user_id);

-- ---- report_embeddings ----------------------------------------------------
alter table public.report_embeddings enable row level security;

drop policy if exists "report_embeddings_select_own" on public.report_embeddings;
create policy "report_embeddings_select_own" on public.report_embeddings
  for select using (auth.uid() = user_id);

drop policy if exists "report_embeddings_insert_own" on public.report_embeddings;
create policy "report_embeddings_insert_own" on public.report_embeddings
  for insert with check (auth.uid() = user_id);

drop policy if exists "report_embeddings_update_own" on public.report_embeddings;
create policy "report_embeddings_update_own" on public.report_embeddings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "report_embeddings_delete_own" on public.report_embeddings;
create policy "report_embeddings_delete_own" on public.report_embeddings
  for delete using (auth.uid() = user_id);

-- ---- analysis_jobs ---------------------------------------------------------
-- RLS + a SELECT policy already exist (schema_jobs.sql, needed for the
-- frontend's Realtime subscription). Add the remaining INSERT/UPDATE/DELETE
-- policies for completeness/defense-in-depth; the backend itself only ever
-- writes this table via service_role, which ignores these policies anyway.
drop policy if exists "analysis_jobs_insert_own" on public.analysis_jobs;
create policy "analysis_jobs_insert_own" on public.analysis_jobs
  for insert with check (auth.uid() = user_id);

drop policy if exists "analysis_jobs_update_own" on public.analysis_jobs;
create policy "analysis_jobs_update_own" on public.analysis_jobs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "analysis_jobs_delete_own" on public.analysis_jobs;
create policy "analysis_jobs_delete_own" on public.analysis_jobs
  for delete using (auth.uid() = user_id);

-- ============================================================================
-- STEP 5 — SUPABASE STORAGE (only relevant if/when raw .mp4 uploads move
-- from local disk — see config.yaml `directories.pending_uploads` — into a
-- Supabase Storage bucket).
-- ============================================================================
-- Today, POST /analyze-video (api.py `_persist_pending_upload`) writes
-- uploads to local backend disk, not Supabase Storage, so there is currently
-- no `storage.objects` exposure to secure. These policies are provided
-- ready-to-run for when/if that changes, assuming:
--   - a bucket named 'video-uploads' (rename below if different)
--   - objects are stored under the key prefix `{user_id}/{filename}`, e.g.
--     `4b1f.../acme-demo.mp4`, so `storage.foldername(name)` (which splits
--     the object path on '/') returns the owning user_id as its first segment
--
-- insert into storage.buckets (id, name, public)
--   values ('video-uploads', 'video-uploads', false)
--   on conflict (id) do nothing;
--
-- drop policy if exists "video_uploads_select_own" on storage.objects;
-- create policy "video_uploads_select_own" on storage.objects
--   for select using (
--     bucket_id = 'video-uploads'
--     and auth.uid()::text = (storage.foldername(name))[1]
--   );
--
-- drop policy if exists "video_uploads_insert_own" on storage.objects;
-- create policy "video_uploads_insert_own" on storage.objects
--   for insert with check (
--     bucket_id = 'video-uploads'
--     and auth.uid()::text = (storage.foldername(name))[1]
--   );
--
-- drop policy if exists "video_uploads_update_own" on storage.objects;
-- create policy "video_uploads_update_own" on storage.objects
--   for update using (
--     bucket_id = 'video-uploads'
--     and auth.uid()::text = (storage.foldername(name))[1]
--   );
--
-- drop policy if exists "video_uploads_delete_own" on storage.objects;
-- create policy "video_uploads_delete_own" on storage.objects
--   for delete using (
--     bucket_id = 'video-uploads'
--     and auth.uid()::text = (storage.foldername(name))[1]
--   );
