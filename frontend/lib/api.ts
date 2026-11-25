// Client for the FastAPI backend (api.py). Kept isolated from UI components
// so the fetch/parsing logic can change without touching dashboard markup.

import { createClient } from "@/lib/supabase/client"

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

// One extracted claim within a pillar. `timestamp` (seconds into the video)
// is only ever set for mp4 uploads (Whisper segment data); YouTube-sourced
// and legacy (pre-migration) claims always have `timestamp: null`.
export interface Claim {
  text: string
  timestamp: number | null
}

export interface BattlecardReport {
  new_features: Claim[]
  pricing_changes: Claim[]
  marketing_message: Claim[]
  objections_or_risks: Claim[]
}

// One Whisper segment, used to render the raw-transcript panel so a claim's
// timestamp can be resolved to a specific place in the transcript.
export interface TranscriptSegment {
  start: number
  text: string
}

// LLM-generated diff against a competitor's previous report; null when this
// is the competitor's first report or the diff step couldn't run.
export interface ChangesSummary {
  new_features: string
  pricing_changes: string
  marketing_message: string
  objections_or_risks: string
  has_changes: boolean
}

// Async Job Queue: mirrors the `analysis_jobs`
// table's `status` check constraint (see src/storage/schema_jobs.sql).
export type JobStatus = "pending" | "transcribing" | "analyzing" | "completed" | "failed"

// `analysis_jobs` row shape, as read directly from Supabase (Realtime + the
// initial fetch in `useAnalysisJob`) rather than through the FastAPI backend.
export interface AnalysisJob {
  id: string
  user_id: string | null
  source_type: "upload" | "youtube"
  competitor_name: string
  status: JobStatus
  current_step: string | null
  error_message: string | null
  result_report_id: string | null
  original_filename: string | null
  created_at: string
  updated_at: string
}

// POST /analyze and POST /analyze-video now enqueue a job and return
// immediately (202 for a freshly created job, 200 when an identical
// in-flight/completed job already exists) instead of the full report.
export interface AnalyzeJobResponse {
  status: "accepted" | "duplicate"
  job_id: string
  job_status: JobStatus
  result_report_id: string | null
}

// Lightweight row returned by GET /reports (list view) — no transcript/pillars.
export interface ReportSummary {
  id: string
  filename: string
  created_at: string
  competitor_name: string | null
}

// Full row returned by GET /reports/{id} — same shape as the `reports` table.
export interface ReportDetail extends BattlecardReport {
  id: string
  filename: string
  created_at: string
  raw_transcript: string
  raw_segments: TranscriptSegment[] | null
  competitor_name: string | null
  changes_summary: ChangesSummary | null
}

// One ranked claim match from GET /search (pgvector cosine similarity over
// all stored reports' pillar claims, not just the currently open report).
export interface SearchResult {
  id: string
  report_id: string
  competitor_id: string | null
  competitor_name: string | null
  pillar: "new_features" | "pricing_changes" | "marketing_message" | "objections_or_risks"
  claim_text: string
  claim_timestamp: number | null
  report_created_at: string
  similarity: number
}

export class ApiError extends Error {}

/** 402 from POST /analyze(-video) once a beta trial has ended with no payment. */
export class PaymentRequiredError extends ApiError {
  checkoutUrl: string | null

  constructor(message: string, checkoutUrl: string | null) {
    super(message)
    this.name = 'PaymentRequiredError'
    this.checkoutUrl = checkoutUrl
  }
}

export interface EntitlementStatus {
  entitlement_status: string
  is_entitled: boolean
  trial_ends_at: string | null
  checkout_url: string | null
}

type FastApiErrorBody = {
  detail?:
    | string
    | {
        error?: string
        message?: string
        checkout_url?: string | null
      }
}

function throwForFailedResponse(status: number, body: FastApiErrorBody | null): never {
  const detail = body?.detail
  if (typeof detail === 'object' && detail !== null && detail.error === 'payment_required') {
    throw new PaymentRequiredError(
      detail.message ?? 'Your beta trial has ended. Upgrade to continue generating battlecards.',
      detail.checkout_url ?? null,
    )
  }
  const message =
    typeof detail === 'string'
      ? detail
      : typeof detail === 'object' && detail !== null && detail.message
        ? detail.message
        : `Request failed with status ${status}`
  throw new ApiError(message)
}

// Every route on the backend now requires a valid Supabase session; attach
// the current access token as a bearer header on every request.
async function withAuthHeaders(init?: RequestInit): Promise<RequestInit> {
  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const headers = new Headers(init?.headers)
  if (session?.access_token) {
    headers.set("Authorization", `Bearer ${session.access_token}`)
  }

  return { ...init, headers }
}

/**
 * Fetch wrapper for every request to the FastAPI backend. Attaches the
 * current Supabase session's `access_token` as `Authorization: Bearer
 * <token>` (via `withAuthHeaders`) so `require_auth` (src/auth/dependencies.py)
 * can resolve the caller's `user_id` — every function below (`listReports`,
 * `analyzeVideoUrl`, `searchReports`, etc.) is built on top of this, so
 * new call sites (e.g. the dashboard's analysis modal) should use it too
 * rather than calling `fetch` directly.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, await withAuthHeaders(init))
  } catch {
    throw new ApiError("Could not reach the analysis server. Is the FastAPI backend running?")
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as FastApiErrorBody | null
    throwForFailedResponse(response.status, body)
  }

  return response.json()
}

/**
 * Uploads an .mp4 file to POST /analyze-video. The backend now only enqueues an `analysis_jobs` row and
 * returns its id immediately — it does NOT transcribe/analyze inline
 * anymore. Callers must track `job_id` (via `useAnalysisJob`, Realtime) to
 * find out when the report is actually ready.
 */
export async function analyzeVideoFile(file: File, competitor: string): Promise<AnalyzeJobResponse> {
  const formData = new FormData()
  formData.append("file", file)
  formData.append("competitor", competitor)
  return apiFetch<AnalyzeJobResponse>("/analyze-video", { method: "POST", body: formData })
}

/**
 * Submits a YouTube URL to POST /analyze. Same async enqueue-only contract
 * as `analyzeVideoFile` above.
 */
export async function analyzeVideoUrl(url: string, competitor: string): Promise<AnalyzeJobResponse> {
  return apiFetch<AnalyzeJobResponse>("/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, competitor }),
  })
}

/** Fetches saved report metadata (id, filename, created_at) from Supabase, newest first. */
export async function listReports(): Promise<ReportSummary[]> {
  const { data } = await apiFetch<{ status: string; data: ReportSummary[] }>("/reports")
  return data
}

/** Fetches one saved report's full detail (pillars + raw transcript) from Supabase. */
export async function getReport(id: string): Promise<ReportDetail> {
  const { data } = await apiFetch<{ status: string; data: ReportDetail }>(`/reports/${id}`)
  return data
}

/**
 * Semantic search: queries claim embeddings across ALL saved reports
 * via GET /search, e.g. "what has X said about pricing in the last 6 months".
 * `months` (optional) restricts results to reports created in that window.
 */
export async function searchReports(query: string, months?: number): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query })
  if (months) params.set("months", String(months))
  const { data } = await apiFetch<{ status: string; data: SearchResult[] }>(`/search?${params.toString()}`)
  return data
}

/** Entitlement snapshot for the paywall banner / settings plan card. */
export async function getBillingStatus(): Promise<EntitlementStatus> {
  const { data } = await apiFetch<{ status: string; data: EntitlementStatus }>('/billing/status')
  return data
}

/**
 * Phase 1 account deletion. `confirmation` must be exactly `DELETE`
 * (config.yaml `account.deletion_confirmation`). Does not hard-delete
 * `analysis_jobs` — that is a separate, operator-gated script.
 */
export async function requestAccountDeletion(confirmation: string): Promise<{ status: string; message: string }> {
  return apiFetch<{ status: string; message: string }>('/account/delete-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation }),
  })
}
