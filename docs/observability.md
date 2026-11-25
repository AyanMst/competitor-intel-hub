# Observability

Additive instrumentation only. Secrets stay in environment variables; names
and sample rates live in `config.yaml` under `observability`.

## Crash reporting (Sentry)

| Surface | Init location | Env var |
| --- | --- | --- |
| FastAPI (`api.py`) | `src/observability/sentry_init.py` (called from `api.py` after imports) | `SENTRY_DSN` (optional `SENTRY_ENVIRONMENT`) |
| Next.js | `frontend/instrumentation.ts`, `frontend/instrumentation-client.ts` | `NEXT_PUBLIC_SENTRY_DSN` (optional `NEXT_PUBLIC_SENTRY_ENVIRONMENT`) |

Both inits are no-ops when the DSN is unset. `traces_sample_rate` is `0` so
this is crash reporting, not request tracing.

**Do not** add Sentry wrapping inside `src/workers/job_worker.py`,
`claim_pending_jobs`, or other concurrency-sensitive paths. Worker errors
continue to surface through existing structured logs.

Optional source-map upload for the Next.js build (not required for crashes
to report): set `SENTRY_ORG`, `SENTRY_PROJECT`, and `SENTRY_AUTH_TOKEN`.

## Product analytics (PostHog)

Initialized at the root layout (`frontend/app/layout.tsx` →
`AnalyticsProvider`). Automatic `$pageview` on App Router navigations.

| Event name | When it fires | Where |
| --- | --- | --- |
| `signup` | First authenticated session within 24h of account creation | Layout (`AuthConversions`) |
| `first_battlecard_generated` | User observes a completed analysis and has ≤ 1 saved report | `NewAnalysisButton`, `/` dashboard |
| `paywall_hit` | Paywall banner is shown, or generate returns 402 | `PaywallBanner`, `NewAnalysisButton` |

These names are defined in `frontend/lib/analytics.ts` and
`config.yaml` → `observability.analytics.events`. **Frontend only** — do
not emit them from `job_worker.py` or any backend job-processing code.

| Env var | Purpose |
| --- | --- |
| `NEXT_PUBLIC_POSTHOG_KEY` | Project API key (unset = analytics disabled) |
| `NEXT_PUBLIC_POSTHOG_HOST` | Defaults to `https://us.i.posthog.com` |

## Uptime monitoring

The backend already exposes an unauthenticated liveness probe:

```http
GET /health
```

It returns `{"status":"healthy"}` and does not touch the database. Point
an external monitor at `https://<backend-host>/health`.

### UptimeRobot

1. Add an **HTTP(s)** monitor.
2. URL: `https://<backend-host>/health`.
3. Interval: 5 minutes (or your SLA).
4. Keyword (optional): `healthy`.
5. Alert contacts: on-call email/Slack.

Add a second HTTP monitor for the Next.js origin (`https://<frontend-host>/`)
if you want the marketing/app shell covered independently.

### Render

On the FastAPI Docker web service: **Settings → Health Check Path** =
`/health`. Render will mark the deploy unhealthy if this path is not 2xx.

### Vercel

The Next.js frontend is a Vercel project. Enable **Speed Insights** /
project-level uptime if you use Vercel Monitoring, or rely on the
UptimeRobot check against the production URL. This repo does not enable
Sentry's `automaticVercelMonitors` (that feature is for Vercel Cron jobs).

## Dependency scanning (CI)

`.github/workflows/dependency-audit.yml` runs on every pull request:

- Backend: `pip-audit` via `scripts/pip_audit_ci.py` — **fails only on
  high/critical** (or CVSS ≥ 7.0). Low/moderate/unknown findings are
  printed and do not block the merge.
- Frontend: `npm audit --audit-level=high` in `frontend/` — same policy.
