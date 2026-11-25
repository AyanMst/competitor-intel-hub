import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BattlecardView } from '@/components/dashboard/battlecard-view'
import type { ChangesSummary, Claim, TranscriptSegment } from '@/lib/api'

export const dynamic = 'force-dynamic'

interface ReportRow {
  id: string
  filename: string
  created_at: string
  raw_transcript: string
  raw_segments: TranscriptSegment[] | null
  new_features: Claim[]
  pricing_changes: Claim[]
  marketing_message: Claim[]
  objections_or_risks: Claim[]
  changes_summary: ChangesSummary | null
  competitors: { name: string } | null
}

interface ReportDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function ReportDetailPage({ params }: ReportDetailPageProps) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // middleware.ts (updateSession) already redirects unauthenticated requests
  // to /login before this Server Component ever runs — this is a
  // defense-in-depth fallback, not the primary gate.
  if (!user) {
    redirect('/login')
  }

  // NOTE: the original design called for `.select('*, citations(*)')`, but
  // there is no `citations` table in this schema (see src/storage/schema*.sql)
  // — per-claim citations already live inline as each pillar's
  // `{text, timestamp}` array, and the Whisper segments used to resolve a
  // citation's timestamp to transcript text live in `raw_segments` on this
  // same row. This mirrors exactly what `reports_repository.get_report`
  // (the FastAPI equivalent) selects.
  //
  // Queries Supabase directly using the caller's own session (not the
  // FastAPI backend's service_role client), so the `reports` RLS policy
  // (see src/storage/schema_rls_isolation.sql) is what actually enforces
  // tenant isolation here. `.eq('user_id', user.id)` is defense-in-depth on
  // top of that policy — and, combined with `.single()` below, ensures a
  // valid id that belongs to ANOTHER tenant 404s exactly like a nonexistent
  // one, never leaking whether it exists.
  const { data: report, error } = await supabase
    .from('reports')
    .select(
      'id, filename, created_at, raw_transcript, raw_segments, new_features, pricing_changes, marketing_message, objections_or_risks, changes_summary, competitors(name)',
    )
    .eq('id', id)
    .eq('user_id', user.id)
    .single()
    .returns<ReportRow>()

  if (error || !report) {
    notFound()
  }

  return (
    <BattlecardView
      report={{
        id: report.id,
        filename: report.filename,
        created_at: report.created_at,
        raw_transcript: report.raw_transcript,
        raw_segments: report.raw_segments,
        new_features: report.new_features,
        pricing_changes: report.pricing_changes,
        marketing_message: report.marketing_message,
        objections_or_risks: report.objections_or_risks,
        changes_summary: report.changes_summary,
        competitor_name: report.competitors?.name ?? null,
      }}
    />
  )
}
