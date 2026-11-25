-- One-time setup: run this in the Supabase SQL Editor for this project.
-- Adds semantic search on top of the existing `reports` /
-- `competitors` tables. Purely additive — does not alter any existing table.
--
-- Stores one embedding per pillar-claim (not per whole report), so search
-- results can point at the exact claim + timestamp that matched, reusing the
-- the timestamp-jump UI. Assumes reports are immutable after creation
-- (true today — there is no update path in reports_repository.py), which is
-- why `report_created_at` is safely denormalized here for cheap date filtering.

create extension if not exists vector;

create table if not exists public.report_embeddings (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  competitor_id uuid references public.competitors(id) on delete set null,
  pillar text not null check (
    pillar in ('new_features', 'pricing_changes', 'marketing_message', 'objections_or_risks')
  ),
  claim_text text not null,
  claim_timestamp double precision,
  report_created_at timestamptz not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);

create index if not exists report_embeddings_embedding_idx
  on public.report_embeddings
  using hnsw (embedding vector_cosine_ops);

create index if not exists report_embeddings_report_id_idx
  on public.report_embeddings (report_id);

create index if not exists report_embeddings_competitor_id_idx
  on public.report_embeddings (competitor_id);

create index if not exists report_embeddings_created_at_idx
  on public.report_embeddings (report_created_at desc);

-- Cosine-similarity search with optional recency / competitor / pillar filters.
create or replace function public.match_report_embeddings(
  query_embedding vector(1536),
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
  where (since_date is null or e.report_created_at >= since_date)
    and (filter_competitor_id is null or e.competitor_id = filter_competitor_id)
    and (filter_pillar is null or e.pillar = filter_pillar)
  order by e.embedding <=> query_embedding
  limit match_count;
$$;

-- Backend uses the service_role key (bypasses RLS), so no RLS policies are
-- required, consistent with the existing `reports` / `competitors` tables.
