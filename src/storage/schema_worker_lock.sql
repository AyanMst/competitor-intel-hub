-- One-time setup: run this in the Supabase SQL Editor for this project.
--
-- WORKER CONCURRENCY
-- (critical, pre-production).
--
-- Problem: src/workers/job_worker.py used to find work with a plain
-- `SELECT ... WHERE status = 'pending'` (jobs_repository.list_pending_jobs),
-- then only flipped a row's status once it started processing it. That
-- read-then-write is NOT atomic. If job_worker.py is ever run as more than
-- one instance (horizontal scaling) — or a restarted instance briefly
-- overlaps with the old one before it fully exits — two workers can both
-- SELECT the same 'pending' row in the same window and both start
-- processing it, duplicating every Whisper + OpenAI LLM call (and the bill)
-- for that job.
--
-- Fix: `claim_pending_jobs(batch_size)` atomically selects AND claims a
-- batch of pending jobs in a single statement, using
-- `FOR UPDATE SKIP LOCKED` so that concurrent callers never see (or block
-- waiting on) rows another caller already grabbed — each row is claimed by
-- exactly one caller, ever. job_worker.py now calls this RPC instead of the
-- old SELECT (see src/storage/jobs_repository.py claim_pending_jobs()).
--
-- Safe to re-run: `create or replace function` is idempotent.

create or replace function public.claim_pending_jobs(batch_size int)
returns setof public.analysis_jobs
language plpgsql
as $$
begin
  return query
    update public.analysis_jobs
    set status = 'transcribing',
        current_step = 'claimed'
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

-- Only the backend's service_role connection (src/workers/job_worker.py)
-- calls this RPC; no anon/authenticated access is required or granted.
revoke all on function public.claim_pending_jobs(int) from public;
grant execute on function public.claim_pending_jobs(int) to service_role;
