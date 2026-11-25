-- One-time setup: run this in the Supabase SQL Editor for this project.
--
-- ACCOUNT DELETION (Account Lifecycle): audit trail for the user-facing
-- "delete my account" flow (see src/account/deletion_service.py,
-- src/account/routes.py's `POST /account/delete-request`).
--
-- Deliberately two-phase, matching the code's own split:
--   Phase 1 (this table's row is inserted here, status='requested'):
--     access revoked (auth user banned), entitlement canceled, the user's
--     own uploaded files deleted from local disk. Runs immediately, with no
--     confirmation gate beyond the user's own request, because none of
--     this touches `analysis_jobs` or `reports`.
--   Phase 2 (status is later updated to 'purged' by a human, NOT by any
--     app code path): a developer reviews and manually runs
--     scripts/purge_deleted_account.py, which hard-deletes the user's
--     `analysis_jobs`/`reports` rows and the auth user itself. That script
--     requires an explicit --confirm flag and is not wired into any route,
--     cron, or webhook — see its module docstring.
--
-- Safe to re-run: every statement is idempotent.

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  -- Not a foreign key to auth.users(id): Phase 2 hard-deletes that row, and
  -- this audit record must survive that (on delete cascade would silently
  -- erase the only record that a deletion ever happened).
  user_id uuid not null,
  user_email text,
  requested_at timestamptz not null default now(),
  -- 'requested': Phase 1 has run (access revoked, files deleted).
  -- 'purged': a human has run scripts/purge_deleted_account.py for this
  --   user_id. Set by that script, never by any request-handling code.
  status text not null default 'requested'
    check (status in ('requested', 'purged')),
  purged_at timestamptz
);

create index if not exists account_deletion_requests_user_id_idx
  on public.account_deletion_requests (user_id);

create index if not exists account_deletion_requests_status_idx
  on public.account_deletion_requests (status);

-- Backend-only table (service_role) — no legitimate reason for a browser
-- session to ever read or write this directly, so RLS is enabled with no
-- policies at all (default-deny for anon/authenticated roles).
alter table public.account_deletion_requests enable row level security;
