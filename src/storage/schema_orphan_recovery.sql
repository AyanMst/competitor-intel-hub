-- One-time setup: run this in the Supabase SQL Editor for this project.
--
-- ORPHAN JOB RECOVERY.
--
-- Problem: if a worker process dies (OOM, deploy restart, uncaught crash)
-- while a job is mid-flight, that row is left sitting in 'transcribing' or
-- 'analyzing' forever. Nothing ever re-queues it: `claim_pending_jobs`
-- (schema_worker_lock.sql) only ever looks at status = 'pending', so a job
-- stuck in a processing state is invisible to every future poll cycle.
-- From the user's side that job just hangs at "Analyzing..." indefinitely
-- with no path to recovery short of a manual DB edit.
--
-- Fix, in three parts, all in this file:
--   1. Three new columns on `analysis_jobs` that give the reaper enough
--      information to tell "orphaned" apart from "just started" and to
--      cap how many times a flaky job gets retried:
--        - claimed_at:     when the row was last picked up by a worker.
--                           NULL while pending; stamped by claim_pending_jobs.
--        - attempt_count:  how many times this row has been claimed, ever.
--        - max_retries:    attempt_count ceiling before we give up for good.
--   2. `claim_pending_jobs` (superseding schema_worker_lock.sql's version —
--      create or replace is idempotent, this is the same function, not a
--      new one) now stamps claimed_at and increments attempt_count as part
--      of the same atomic claim UPDATE.
--   3. `requeue_orphan_jobs(timeout_minutes)`: the reaper. Atomically finds
--      every 'transcribing'/'analyzing' row whose claimed_at is older than
--      the timeout and either bounces it back to 'pending' (attempt_count
--      still under max_retries — a future poll cycle will pick it back up)
--      or gives up and marks it 'failed' (attempt_count exhausted), so a
--      dead job never just sits there unowned. Called on a schedule by
--      src/workers/job_worker.py (see requeue_orphan_jobs in
--      jobs_repository.py).
--
-- Safe to re-run: every statement is idempotent (`add column if not
-- exists`, `create or replace function`, `create index if not exists`).
--
-- ============================================================================
-- STEP 1 — NEW COLUMNS
-- ============================================================================

alter table public.analysis_jobs
  add column if not exists max_retries int not null default 3;

alter table public.analysis_jobs
  add column if not exists attempt_count int not null default 0;

alter table public.analysis_jobs
  add column if not exists claimed_at timestamptz;

-- ============================================================================
-- STEP 2 — claim_pending_jobs NOW STAMPS claimed_at / attempt_count
-- ============================================================================
-- Same signature/return type as schema_worker_lock.sql's version, just with
-- two more columns in the SET list — every existing caller
-- (jobs_repository.claim_pending_jobs) keeps working unchanged.

create or replace function public.claim_pending_jobs(batch_size int)
returns setof public.analysis_jobs
language plpgsql
as $$
begin
  return query
    update public.analysis_jobs
    set status = 'transcribing',
        current_step = 'claimed',
        claimed_at = now(),
        attempt_count = attempt_count + 1
    where id in (
      select id
      from public.analysis_jobs
      where status = 'pending'
      order by created_at
      limit batch_size
      for update skip locked
    )
    returning *;
end;
$$;

revoke all on function public.claim_pending_jobs(int) from public;
grant execute on function public.claim_pending_jobs(int) to service_role;

-- ============================================================================
-- STEP 3 — THE REAPER: requeue_orphan_jobs(timeout_minutes)
-- ============================================================================
-- `for update skip locked` guards against this ever racing a real, still-
-- alive worker that happens to be writing to the same row via
-- update_job_status at the exact moment the reaper runs — it simply skips
-- that row this cycle rather than blocking or double-handling it.
--
-- Keys off claimed_at (only ever set at claim time), not updated_at, since
-- updated_at is bumped by every progress update a live worker makes —
-- keying off it would make a slow-but-healthy job look orphaned right after
-- its last progress tick, instead of only when nothing has touched it since
-- it was claimed.
--
-- timeout_minutes has no default here on purpose — the caller
-- (jobs_repository.requeue_orphan_jobs) owns the default so it lives in one
-- place, not duplicated between Python and SQL.

create or replace function public.requeue_orphan_jobs(timeout_minutes int)
returns setof public.analysis_jobs
language plpgsql
as $$
begin
  return query
    update public.analysis_jobs
    set status = case when attempt_count < max_retries then 'pending' else 'failed' end,
        current_step = case when attempt_count < max_retries then 'requeued (orphaned)' else 'Failed' end,
        claimed_at = case when attempt_count < max_retries then null else claimed_at end,
        error_message = case
          when attempt_count < max_retries then error_message
          else format(
            'Orphaned: stuck in "%s" for over %s minute(s) without completing, after %s/%s attempt(s). Worker likely crashed or was killed mid-job.',
            status, timeout_minutes, attempt_count, max_retries
          )
        end
    where id in (
      select id
      from public.analysis_jobs
      where status in ('transcribing', 'analyzing')
        and claimed_at is not null
        and claimed_at < now() - (timeout_minutes || ' minutes')::interval
      for update skip locked
    )
    returning *;
end;
$$;

-- Only the backend's service_role connection (src/workers/job_worker.py, via
-- the scheduled reaper) calls this RPC; no anon/authenticated access.
revoke all on function public.requeue_orphan_jobs(int) from public;
grant execute on function public.requeue_orphan_jobs(int) to service_role;

-- Lookup path for the reaper: find stuck processing rows without scanning
-- every 'completed'/'failed' row in the table. Partial index keeps it tiny
-- since 'transcribing'/'analyzing' rows are a small, short-lived slice of
-- the table at any given time.
create index if not exists analysis_jobs_orphan_reaper_idx
  on public.analysis_jobs (claimed_at)
  where status in ('transcribing', 'analyzing');
