-- One-time setup: run this in the Supabase SQL Editor for this project.
-- Adds Scheduled Channel Monitoring on top of the existing `reports` /
-- `competitors` tables. Purely additive — does not alter any existing table.
--
-- `tracked_channels` holds the YouTube channels the scheduler polls.
-- `processed_videos` is the idempotency ledger: one row per video_id ever
-- attempted, so the poller can skip videos it has already handled (success
-- or failure) instead of re-running Whisper/LLM analysis on every cycle.

create table if not exists public.tracked_channels (
  id uuid primary key default gen_random_uuid(),
  channel_url text not null unique,
  youtube_channel_id text,
  channel_name text,
  competitor_id uuid references public.competitors(id) on delete set null,
  is_active boolean not null default true,
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists tracked_channels_is_active_idx
  on public.tracked_channels (is_active);

create index if not exists tracked_channels_competitor_id_idx
  on public.tracked_channels (competitor_id);

create table if not exists public.processed_videos (
  id uuid primary key default gen_random_uuid(),
  video_id text not null unique,
  tracked_channel_id uuid references public.tracked_channels(id) on delete cascade,
  video_url text not null,
  report_id uuid references public.reports(id) on delete set null,
  status text not null default 'success' check (status in ('success', 'failed')),
  error_message text,
  processed_at timestamptz not null default now()
);

create index if not exists processed_videos_tracked_channel_id_idx
  on public.processed_videos (tracked_channel_id);

create index if not exists processed_videos_processed_at_idx
  on public.processed_videos (processed_at desc);

-- The backend talks to these tables using the service_role key, which
-- bypasses Row Level Security entirely, so no RLS policies are required,
-- consistent with the existing `reports` / `competitors` tables.
