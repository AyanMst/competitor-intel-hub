-- One-time setup: run this in the Supabase SQL Editor, right after schema.sql.
--
-- Creates the `competitors` lookup table and adds the report columns that
-- reports_repository.py / competitors_repository.py write but schema.sql does
-- not define. NOTE: reconstructed from the repository code, so it matches what
-- the app reads and writes, but it has not been diffed against the original
-- hosted database.
--
-- Safe to re-run: every statement is idempotent.

create table if not exists public.competitors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
-- Per-tenant uniqueness (user_id, lower(name)) is added by schema_rls_isolation.sql.

-- The app stores each pillar as a jsonb array of {"text", "timestamp"} claims.
alter table public.reports
  alter column pricing_changes type jsonb
    using coalesce(to_jsonb(pricing_changes), '[]'::jsonb),
  alter column marketing_message type jsonb
    using coalesce(to_jsonb(marketing_message), '[]'::jsonb),
  alter column objections_or_risks type jsonb
    using coalesce(to_jsonb(objections_or_risks), '[]'::jsonb);

alter table public.reports
  add column if not exists competitor_id uuid references public.competitors(id) on delete set null,
  add column if not exists changes_summary jsonb,
  add column if not exists raw_segments jsonb;

create index if not exists reports_competitor_id_idx on public.reports (competitor_id);
