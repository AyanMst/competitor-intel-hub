-- One-time setup: run this in the Supabase SQL Editor for this project.
--
-- PAYWALL / ENTITLEMENTS (Monetization Gating): backs the beta trial ->
-- paid-access gate on POST /analyze and POST /analyze-video (see
-- src/billing/dependencies.py's `require_entitlement`, wired into api.py).
--
-- One row per user. Created lazily (status='trialing') the first time an
-- authenticated request needs an entitlement decision — see
-- `src/storage/entitlements_repository.ensure_trial_entitlement`. There is
-- no `INSERT`/`UPDATE` path for this table other than: (a) that lazy
-- trial-row creation, and (b) the Stripe webhook handler
-- (src/billing/routes.py) marking a row 'active' after a confirmed payment.
-- Nothing else in this codebase writes to this table.
--
-- Safe to re-run: every statement is idempotent (`if not exists` / `drop ...
-- if exists` before `create`), matching every other schema_*.sql file here.

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  -- 'trialing': within the free beta trial window (trial_ends_at).
  -- 'active': a confirmed Stripe payment has unlocked full access.
  -- 'past_due' / 'canceled': reserved for a future recurring-subscription
  --   model; unused by the current one-time-payment flow, kept so the check
  --   constraint doesn't need another migration if that changes later.
  -- 'expired': trial window has passed with no confirmed payment — this is
  --   NOT written by any code path today; `is_entitled()` (see
  --   entitlements_repository.py) derives "expired" at read time by
  --   comparing trial_ends_at to now() rather than requiring a background
  --   job to flip a status column on a schedule.
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  plan text not null default 'beta_trial',
  trial_ends_at timestamptz,
  -- Populated once the Stripe webhook confirms a payment for this user.
  stripe_customer_id text,
  stripe_checkout_session_id text,
  -- One-time-payment model (see payment_model decision, chat record): this
  -- is NOT re-checked on any recurring schedule. Present for a future
  -- recurring-subscription upgrade so that migration is additive.
  current_period_end timestamptz,
  activated_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists entitlements_user_id_idx on public.entitlements (user_id);

-- Fast lookup for the Stripe webhook handler, which only ever has the
-- Checkout Session's customer id to key off of, not user_id directly.
create index if not exists entitlements_stripe_customer_id_idx
  on public.entitlements (stripe_customer_id);

create or replace function public.set_entitlements_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists entitlements_set_updated_at on public.entitlements;
create trigger entitlements_set_updated_at
  before update on public.entitlements
  for each row
  execute function public.set_entitlements_updated_at();

-- The backend (src/storage/entitlements_repository.py) talks to this table
-- using the service_role key, which bypasses RLS entirely — same pattern as
-- every other table in this project. RLS + a strict SELECT-only policy is
-- still enabled below as defense-in-depth for any future direct-from-
-- browser read (e.g. a Realtime subscription mirroring analysis_jobs' own
-- pattern in schema_jobs.sql). No INSERT/UPDATE/DELETE policy is granted to
-- authenticated/anon roles — every write to this table must go through the
-- backend (service_role), on purpose: a user must never be able to grant
-- themselves entitlement by writing their own row directly.
alter table public.entitlements enable row level security;

drop policy if exists "entitlements_select_own" on public.entitlements;
create policy "entitlements_select_own" on public.entitlements
  for select using (auth.uid() = user_id);
