# Competitor Intel Hub

Turn competitor videos into structured competitive-intelligence "battlecards".
Paste a YouTube URL or upload an mp4; the backend transcribes it, extracts what
matters with an LLM, stores a searchable report, and can keep watching
competitor channels for you.

> **Status: production-architecture MVP.** The backend and data layer are built
> the way a real multi-tenant SaaS would be (auth, row-level security, job
> queue, billing gate, account deletion). It is a portfolio project, not a
> launched product. See [Known limitations](#known-limitations--roadmap).

## Key features

- **Video to battlecard**: YouTube URL or uploaded mp4 in; four fixed analysis
  pillars out (new features, pricing changes, marketing message, and more), each
  claim tied to a transcript timestamp.
- **Transcript pipeline**: YouTube captions first, with an ffmpeg + OpenAI
  Whisper fallback when captions are missing.
- **Async job queue**: endpoints enqueue a job and return immediately. A
  background worker drains the queue with atomic claiming, orphan-job recovery,
  and retries. The UI tracks progress live through Supabase Realtime.
- **Semantic search**: per-claim embeddings (pgvector) searched across all of a
  user's reports.
- **Channel monitoring**: track competitor YouTube channels; a scheduler picks up
  new uploads and Slack-alerts notable changes.
- **Multi-tenant security**: Supabase auth, RLS on every tenant table, strict
  CORS, security headers, schema-validated request bodies (`extra="forbid"`),
  upload size and duration caps, filename and content checks.
- **Paywall**: Stripe Payment Link checkout, webhook signature verification, and
  an entitlement gate on the analysis endpoints.
- **Account lifecycle**: two-phase account deletion (immediate access revocation,
  then a reviewed manual purge script).
- **Observability**: optional Sentry crash reporting and PostHog analytics (see
  [docs/observability.md](docs/observability.md)).

## Architecture

```
                     +-------------------------------+
   Browser  <------> |  Next.js 16 (React 19)        |
                     |  Tailwind 4, TanStack Query   |
                     +---------+---------------+-----+
                  Supabase JS  |               | REST (Bearer JWT)
                  auth+realtime|               v
                               |     +---------------------+
                               |     |  FastAPI  (api.py)  |
                               |     |  auth, paywall gate |
                               |     +----+-----------+----+
                               |          | enqueue   | read
                               v          v           v
                     +-------------------------------------------+
                     | Supabase Postgres (RLS)                   |
                     | reports, analysis_jobs, report_embeddings,|
                     | tracked_channels, entitlements, ...       |
                     +-------------------+-----------------------+
                                         ^ claim / update
                     +-------------------+-----------------------+
                     |  In-process APScheduler                   |
                     |   - job worker: drain analysis_jobs       |
                     |   - channel monitor: poll YouTube channels|
                     +-------------------+-----------------------+
                                         v
        yt-dlp / captions --> ffmpeg + Whisper --> chunker --> LLM --> embeddings
                                                                 |
                                                  Slack alert <--+  (notable changes)

   Stripe Payment Link --webhook--> FastAPI --> entitlements table
```

## Tech stack

| Layer | Tech |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4, TanStack Query, `@supabase/ssr` |
| Backend | Python 3.12, FastAPI, Uvicorn, APScheduler, structlog, tenacity |
| AI | OpenAI (Whisper transcription, LLM analysis, embeddings) |
| Media | yt-dlp, youtube-transcript-api, ffmpeg/ffprobe, moviepy |
| Data and auth | Supabase (Postgres, pgvector, RLS, Auth, Realtime) |
| Billing | Stripe (Payment Link + webhooks) |
| Ops | Docker, Sentry, PostHog, GitHub Actions dependency audit |

## Environment variables

**Backend** (`.env`, see [.env.example](.env.example))

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | yes | Whisper, LLM analysis, embeddings |
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Backend DB access (bypasses RLS; server only) |
| `FRONTEND_URL` | yes | Single allowed CORS origin (default `http://localhost:3000`) |
| `STRIPE_SECRET_KEY` | for paywall | Stripe API key (use a test-mode key) |
| `STRIPE_WEBHOOK_SECRET` | for paywall | Webhook signature verification |
| `STRIPE_PAYMENT_LINK_URL` | for paywall | Checkout link shown to users |
| `SLACK_WEBHOOK_URL` | no | Alerts for notable changes |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | no | Crash reporting |

**Frontend** (`frontend/.env.local`, see [frontend/.env.example](frontend/.env.example))

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | yes | FastAPI base URL |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon (public) key |
| `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | no | Crash reporting |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | no | Product analytics |

## Database setup

Create a Supabase project, then run these 10 files **in this exact order** in the
SQL Editor. Each one is idempotent. (`schema_rls_isolation.sql` needs every table to exist before it adds `user_id`, and the
orphan-recovery file replaces the function defined in the worker-lock file.)

1. `src/storage/schema.sql`: base `reports` table
2. `src/storage/schema_competitors.sql`: `competitors` table and extra `reports` columns (reconstructed from the repository code; see the file header)
3. `src/storage/schema_channels.sql`: channel monitoring tables
4. `src/storage/schema_search.sql`: pgvector embeddings and search RPC
5. `src/storage/schema_jobs.sql`: async job queue
6. `src/storage/schema_rls_isolation.sql`: `user_id` columns and RLS on every tenant table
7. `src/storage/schema_worker_lock.sql`: atomic `claim_pending_jobs`
8. `src/storage/schema_orphan_recovery.sql`: retries and orphan reaper
9. `src/storage/schema_account_deletion.sql`: account deletion requests
10. `src/storage/schema_entitlements.sql`: paywall entitlements

`schema_jobs.sql` adds `analysis_jobs` to the Supabase Realtime publication, which
the UI uses for live job progress. Read the header of `schema_rls_isolation.sql` before
running it on a database that already has rows (Step 0 covers legacy data).

## Local setup

Requirements: Python 3.12, Node 20+, `ffmpeg` on your PATH
(`brew install ffmpeg`), a Supabase project, and an OpenAI key.

**Backend**

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # fill in values
uvicorn api:app --reload --port 8000
# health check: curl http://localhost:8000/health
```

**Frontend**

```bash
cd frontend
npm install
cp .env.example .env.local      # fill in values
npm run dev                     # http://localhost:3000
```

**Docker (backend only)**

```bash
docker build -t competitor-intel-hub .
docker run --rm -p 8000:8000 --env-file .env competitor-intel-hub
```

The image installs ffmpeg and honours `$PORT`, so it deploys as-is to a Docker
web service such as Render. Deploy the frontend separately (e.g. Vercel).

## Known limitations & roadmap

- **YouTube blocks datacenter IPs.** yt-dlp and caption fetching work well from a
  residential connection but are frequently throttled or blocked on cloud hosts.
  A production version needs proxies, cookies, or an official-API path.
- **No automated test suite.** The code was verified manually. Adding pytest
  coverage for the repositories and worker, plus Playwright for the UI, is the
  first roadmap item.
- **Legal pages are demo placeholders.** `/privacy` and `/terms` are scaffolds,
  not real policies.
- **The scheduler and worker run in the API process.** Fine for one instance;
  scale-out would move them into a dedicated worker service (the SQL claim
  function is already safe for multiple workers).
- **Stripe uses Payment Links**, not full Checkout Sessions or a customer portal.
- Roadmap: dedicated worker service, test suite, proper subscription management,
  official YouTube Data API integration, more analysis pillars.
