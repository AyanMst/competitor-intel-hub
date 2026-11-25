-- One-time setup: run this in the Supabase SQL Editor for this project.
-- Creates the table used by src/storage/reports_repository.py to persist
-- generated battlecard reports (raw transcript + the 4 fixed pillars).

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  created_at timestamptz not null default now(),
  raw_transcript text not null,
  new_features jsonb not null default '[]'::jsonb,
  pricing_changes text,
  marketing_message text,
  objections_or_risks text
);

create index if not exists reports_created_at_idx on public.reports (created_at desc);

-- The backend talks to this table using the service_role key, which bypasses
-- Row Level Security entirely, so no RLS policies are required for the app
-- to function. If you enable RLS on this table for other reasons (e.g. to
-- later expose it to the browser with the anon key), add explicit policies
-- for select/insert as needed.
