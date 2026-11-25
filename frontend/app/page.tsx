'use client'

import { useEffect, useState } from 'react'
import { Sidebar, type DashboardView } from '@/components/dashboard/sidebar'
import { Header } from '@/components/dashboard/header'
import { CompetitorProfile } from '@/components/dashboard/competitor-profile'
import { ReportsList } from '@/components/dashboard/reports-list'
import {
  analyzeVideoFile,
  analyzeVideoUrl,
  getReport,
  ApiError,
  type AnalyzeJobResponse,
  type BattlecardReport,
  type ChangesSummary,
  type TranscriptSegment,
  type SearchResult,
} from '@/lib/api'
import { useAnalysisJob } from '@/lib/useAnalysisJob'
import { trackFirstBattlecardGenerated } from '@/lib/analytics'
import { PaywallBanner } from '@/components/dashboard/paywall-banner'
import { useEntitlement } from '@/lib/useEntitlement'
import type { JobPhase } from '@/components/dashboard/job-progress'
import type { PillarKey } from '@/components/dashboard/pillar-data'

// One "jump to this claim" request produced by selecting a semantic search
// result. `nonce` changes on every selection so CompetitorProfile can react
// even when the same report/pillar/timestamp is picked twice in a row.
interface PendingCitation {
  pillar: PillarKey
  timestamp: number | null
  nonce: number
}

export default function Page() {
  const [view, setView] = useState<DashboardView>('dashboard')
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)

  const [report, setReport] = useState<BattlecardReport | null>(null)
  const [rawTranscript, setRawTranscript] = useState('')
  const [rawSegments, setRawSegments] = useState<TranscriptSegment[] | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [competitorName, setCompetitorName] = useState<string | null>(null)
  const [changes, setChanges] = useState<ChangesSummary | null>(null)
  const [isLoading, setIsLoading] = useState(false) // fetching an already-finished report (getReport)
  const [error, setError] = useState<string | null>(null)
  const [pendingCitation, setPendingCitation] = useState<PendingCitation | null>(null)
  const { entitlement } = useEntitlement()
  const analysisLocked = entitlement !== null && !entitlement.is_entitled

  // Async Job Queue: POST /analyze(-video) now
  // enqueues a job and returns in milliseconds — `isSubmitting` covers only
  // that initial request. `activeJobId` hands off to Supabase Realtime
  // (`useAnalysisJob`, no HTTP polling) for live status until the job
  // completes (then the finished report is fetched via `getReport`, same as
  // opening a saved report) or fails (kept around, unacknowledged, until the
  // user dismisses it or starts a new analysis).
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)

  async function loadReport(reportId: string) {
    setIsLoading(true)
    setError(null)
    try {
      const detail = await getReport(reportId)
      setReport({
        new_features: detail.new_features,
        pricing_changes: detail.pricing_changes,
        marketing_message: detail.marketing_message,
        objections_or_risks: detail.objections_or_risks,
      })
      setRawTranscript(detail.raw_transcript)
      setRawSegments(detail.raw_segments)
      setFileName(detail.filename)
      setCompetitorName(detail.competitor_name)
      setChanges(detail.changes_summary)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load the completed report.')
    } finally {
      setIsLoading(false)
    }
  }

  const job = useAnalysisJob(activeJobId, (updatedJob) => {
    // Realtime hand-off: once the tracked job reports 'completed',
    // fetch the finished battlecard exactly the same way a saved report is
    // opened, then stop tracking the job. Runs from inside the hook's
    // Realtime callback, not a `useEffect` watching `job`, so there's no
    // separate render-then-react round trip.
    if (updatedJob.status === 'completed' && updatedJob.result_report_id) {
      void trackFirstBattlecardGenerated()
      setActiveJobId(null)
      loadReport(updatedJob.result_report_id)
    }
  })

  const isBusy = isSubmitting || (Boolean(activeJobId) && job?.status !== 'completed' && job?.status !== 'failed')

  const activeJobView =
    isSubmitting || activeJobId
      ? {
          phase: (isSubmitting ? 'uploading' : job?.status ?? 'pending') as JobPhase,
          currentStep: job?.current_step ?? null,
          errorMessage: job?.error_message ?? null,
        }
      : null

  async function startAnalysis(
    submit: () => Promise<AnalyzeJobResponse>,
    label: string,
    competitor: string,
  ) {
    setSelectedReportId(null)
    setView('dashboard')
    setError(null)
    setChanges(null)
    setReport(null)
    setRawTranscript('')
    setRawSegments(null)
    setFileName(label)
    setCompetitorName(competitor)
    setActiveJobId(null)
    setIsSubmitting(true)

    try {
      const response = await submit()
      if (response.job_status === 'completed' && response.result_report_id) {
        // Duplicate of an already-finished job (e.g. re-submitting the same
        // video/URL): nothing to track, the report already exists.
        void trackFirstBattlecardGenerated()
        await loadReport(response.result_report_id)
      } else {
        setActiveJobId(response.job_id)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unexpected error while analyzing the video.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleFileSelected(file: File, competitor: string) {
    await startAnalysis(() => analyzeVideoFile(file, competitor), file.name, competitor)
  }

  async function handleUrlSubmitted(url: string, competitor: string) {
    await startAnalysis(() => analyzeVideoUrl(url, competitor), url, competitor)
  }

  function handleDismissJob() {
    setActiveJobId(null)
  }

  function handleSelectSavedReport(id: string) {
    setActiveJobId(null)
    setSelectedReportId(id)
  }

  // Navigates to the report a semantic search result belongs to, then asks
  // CompetitorProfile to filter to that pillar and (if available) jump the
  // transcript to the cited timestamp once the report finishes loading.
  function handleSearchResultSelected(reportId: string, pillar: SearchResult['pillar'], timestamp: number | null) {
    setView('reports')
    setActiveJobId(null)
    setSelectedReportId(reportId)
    setPendingCitation({ pillar, timestamp, nonce: Date.now() })
  }

  // Loads a saved report's full detail on selection, reusing the same
  // CompetitorProfile detail view as a fresh upload.
  useEffect(() => {
    if (!selectedReportId) return

    let cancelled = false
    setIsLoading(true)
    setError(null)

    getReport(selectedReportId)
      .then((detail) => {
        if (cancelled) return
        setReport({
          new_features: detail.new_features,
          pricing_changes: detail.pricing_changes,
          marketing_message: detail.marketing_message,
          objections_or_risks: detail.objections_or_risks,
        })
        setRawTranscript(detail.raw_transcript)
        setRawSegments(detail.raw_segments)
        setFileName(detail.filename)
        setCompetitorName(detail.competitor_name)
        setChanges(detail.changes_summary)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load the saved report.')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedReportId])

  function handleNavigate(nextView: DashboardView) {
    setView(nextView)
    setSelectedReportId(null)
    setActiveJobId(null)
    if (nextView === 'dashboard') {
      // Returning to Dashboard clears any saved-report detail so the upload
      // flow starts fresh; it does not affect data already saved in Supabase.
      setReport(null)
      setRawTranscript('')
      setRawSegments(null)
      setFileName(null)
      setCompetitorName(null)
      setChanges(null)
      setError(null)
    }
  }

  const showingSavedReportDetail = view === 'reports' && Boolean(selectedReportId)

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar activeView={view} onNavigate={handleNavigate} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          fileName={fileName}
          isLoading={isBusy}
          analysisLocked={analysisLocked}
          onFileSelected={handleFileSelected}
          onUrlSubmitted={handleUrlSubmitted}
          onSearchResultSelected={handleSearchResultSelected}
        />
        <main className="flex-1">
          <div className="px-5 pt-5 lg:px-8">
            <PaywallBanner />
          </div>
          {view === 'reports' && !selectedReportId ? (
            <ReportsList onSelect={handleSelectSavedReport} />
          ) : (
            <CompetitorProfile
              report={report}
              rawTranscript={rawTranscript}
              rawSegments={rawSegments}
              fileName={fileName}
              competitorName={competitorName}
              changes={changes}
              isLoading={isLoading}
              error={error}
              onBack={showingSavedReportDetail ? () => setSelectedReportId(null) : undefined}
              pendingCitation={pendingCitation}
              activeJob={activeJobView}
              onDismissJob={handleDismissJob}
            />
          )}
        </main>
      </div>
    </div>
  )
}
