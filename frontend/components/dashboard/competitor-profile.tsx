'use client'

import { useEffect, useState } from 'react'
import {
  FileVideo,
  Hash,
  Sparkles,
  Tag,
  ShieldAlert,
  ListFilter,
  ChevronDown,
  ChevronLeft,
  Loader2,
  History,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PillarCard } from './pillar-card'
import { pillars, pillarValue, type PillarKey } from './pillar-data'
import { JobProgress, type JobPhase } from './job-progress'
import type { BattlecardReport, ChangesSummary, TranscriptSegment } from '@/lib/api'

interface PendingCitation {
  pillar: PillarKey
  timestamp: number | null
  nonce: number
}

// Async Job Queue: the live state of an
// in-flight /analyze or /analyze-video submission, tracked via
// `useAnalysisJob` (Supabase Realtime) in page.tsx and handed down here so
// this is the one place that renders the progress UI, same as it's the one
// place that renders the finished report.
interface ActiveJobView {
  phase: JobPhase
  currentStep: string | null
  errorMessage: string | null
}

interface CompetitorProfileProps {
  report: BattlecardReport | null
  rawTranscript: string
  rawSegments?: TranscriptSegment[] | null
  fileName: string | null
  competitorName?: string | null
  changes?: ChangesSummary | null
  isLoading: boolean
  error: string | null
  /** When set, renders a "back to saved reports" affordance (viewing a saved report). */
  onBack?: () => void
  /** Set when navigating here from a semantic search result: filters to the
   * matched pillar and (if available) jumps the transcript to its timestamp. */
  pendingCitation?: PendingCitation | null
  /** Non-null while a submitted video is being uploaded/transcribed/analyzed
   * (or just failed). Renders the 4-step progress tracker / red error card
   * in place of the report grid instead of the old opaque spinner. */
  activeJob?: ActiveJobView | null
  /** Called when the user dismisses a failed job's error card. */
  onDismissJob?: () => void
}

export function CompetitorProfile({
  report,
  rawTranscript,
  rawSegments,
  fileName,
  competitorName,
  changes,
  isLoading,
  error,
  onBack,
  pendingCitation,
  activeJob,
  onDismissJob,
}: CompetitorProfileProps) {
  const [activeFilter, setActiveFilter] = useState<'All Pillars' | PillarKey>('All Pillars')
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false)
  const [highlightedSegment, setHighlightedSegment] = useState<number | null>(null)

  const visiblePillars =
    activeFilter === 'All Pillars' ? pillars : pillars.filter((pillar) => pillar.key === activeFilter)

  const wordCount = rawTranscript ? rawTranscript.trim().split(/\s+/).filter(Boolean).length : 0
  const featureCount = report?.new_features.length ?? 0
  const pricingMentioned = Boolean(report && report.pricing_changes.length > 0)
  const risksMentioned = Boolean(report && report.objections_or_risks.length > 0)

  // Jumps the raw-transcript panel to the Whisper segment containing a
  // clicked claim's timestamp. Only available for mp4-sourced reports
  // (rawSegments is null for YouTube reports and legacy saved reports).
  function handleCitationClick(timestamp: number) {
    if (!rawSegments || rawSegments.length === 0) return

    let targetIndex = 0
    for (let i = 0; i < rawSegments.length; i++) {
      if (rawSegments[i].start <= timestamp) targetIndex = i
      else break
    }

    setIsTranscriptOpen(true)
    setHighlightedSegment(targetIndex)
  }

  useEffect(() => {
    if (highlightedSegment === null || !isTranscriptOpen) return
    document.getElementById(`transcript-segment-${highlightedSegment}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  }, [highlightedSegment, isTranscriptOpen])

  // Applies a search-result "citation" once its target report has finished
  // loading: filters to the matched pillar and, if the claim has a
  // timestamp (mp4-sourced only), jumps the transcript to it.
  useEffect(() => {
    if (!pendingCitation || !report) return
    setActiveFilter(pendingCitation.pillar)
    if (pendingCitation.timestamp !== null) handleCitationClick(pendingCitation.timestamp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCitation, report, rawSegments])

  const stats = [
    { label: 'Words Analyzed', value: wordCount.toLocaleString(), icon: Hash },
    { label: 'Features Found', value: String(featureCount), icon: Sparkles },
    { label: 'Pricing Mentioned', value: pricingMentioned ? 'Yes' : 'No', icon: Tag },
    { label: 'Risks Flagged', value: risksMentioned ? 'Yes' : 'No', icon: ShieldAlert },
  ]

  return (
    <div className="mx-auto max-w-[1200px] px-5 py-6 lg:px-8 lg:py-8">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Back to saved reports
        </button>
      ) : null}

      {/* Report header */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-foreground text-background shadow-soft">
            <FileVideo className="size-7" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="truncate text-2xl font-bold tracking-tight text-foreground">
                {fileName ?? 'No video analyzed yet'}
              </h1>
              {competitorName ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
                  {competitorName}
                </span>
              ) : null}
              {activeJob && activeJob.phase !== 'failed' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Analyzing
                </span>
              ) : activeJob && activeJob.phase === 'failed' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive">
                  Analysis failed
                </span>
              ) : isLoading ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading
                </span>
              ) : report ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success/12 px-2.5 py-1 text-xs font-semibold text-success">
                  Report ready
                </span>
              ) : null}
            </div>
            <p className="mt-3 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
              Upload an .mp4 video with &quot;Upload &amp; Analyze Video&quot; above. The transcript is
              extracted with Whisper and analyzed against the four competitive-intelligence pillars below.
            </p>
          </div>
        </div>

        {/* Monitoring summary stats */}
        <div className="mt-6 grid grid-cols-2 gap-3 border-t border-border pt-6 lg:grid-cols-4">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-border bg-secondary/40 p-4 transition-colors hover:border-foreground/15"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{stat.label}</span>
                <span className="flex size-7 items-center justify-center rounded-md bg-slate-100 text-slate-400">
                  <stat.icon className="size-4" />
                </span>
              </div>
              <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">{stat.value}</p>
            </div>
          ))}
        </div>
      </section>

      {error ? (
        <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {/* Change detection: what moved since this competitor's previous report. */}
      {changes && changes.has_changes ? (
        <section className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-soft">
          <div className="flex items-center gap-2">
            <History className="size-4 text-foreground" />
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              What Changed Since Last Report
            </h2>
          </div>
          <ul className="mt-4 flex flex-col gap-3">
            {pillars
              .filter((pillar) => {
                const value = changes[pillar.key]
                return value && value.trim().toLowerCase() !== 'no changes detected.'
              })
              .map((pillar) => (
                <li key={pillar.key} className="flex items-start gap-2.5 text-sm leading-relaxed">
                  <span
                    className={cn(
                      'mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
                      pillar.className,
                    )}
                  >
                    {pillar.label}
                  </span>
                  <span className="text-foreground">{changes[pillar.key]}</span>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      {/* Pillars section */}
      <section className="mt-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
              Competitive Intelligence Battlecard
            </h2>
            <p className="text-sm text-muted-foreground">
              The four B2B pillars extracted from the analyzed video.
            </p>
          </div>
        </div>

        {/* Filter pills */}
        <div className="mt-4 flex flex-wrap gap-2">
          {(['All Pillars', ...pillars.map((p) => p.key)] as const).map((value) => {
            const isActive = activeFilter === value
            const label = value === 'All Pillars' ? 'All Pillars' : pillars.find((p) => p.key === value)!.label
            return (
              <button
                key={value}
                type="button"
                onClick={() => setActiveFilter(value)}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-card text-slate-700 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Cards grid */}
        {report ? (
          <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
            {visiblePillars.map((pillar) => (
              <PillarCard
                key={pillar.key}
                pillar={pillar}
                value={pillarValue(report, pillar.key)}
                fileName={fileName}
                onCitationClick={handleCitationClick}
              />
            ))}
          </div>
        ) : activeJob ? (
          <JobProgress
            phase={activeJob.phase}
            currentStep={activeJob.currentStep}
            errorMessage={activeJob.errorMessage}
            onDismiss={onDismissJob}
          />
        ) : (
          <div className="mt-5 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center">
            <ListFilter className="size-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium text-foreground">No report yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {isLoading ? 'Loading report…' : 'Upload a video to generate a battlecard.'}
            </p>
          </div>
        )}
      </section>

      {/* Raw transcript (collapsible) */}
      {rawTranscript ? (
        <section className="mt-8">
          <button
            type="button"
            onClick={() => setIsTranscriptOpen((open) => !open)}
            className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-5 py-3.5 text-left transition-colors hover:bg-muted/50"
          >
            <span className="text-sm font-semibold text-foreground">Raw Transcript (Whisper)</span>
            <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', isTranscriptOpen && 'rotate-180')} />
          </button>
          {isTranscriptOpen ? (
            <div className="mt-2 max-h-80 overflow-y-auto rounded-xl border border-border bg-secondary/30 p-5">
              {rawSegments && rawSegments.length > 0 ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {rawSegments.map((segment, index) => (
                    <span
                      key={index}
                      id={`transcript-segment-${index}`}
                      className={cn(
                        'rounded px-0.5 transition-colors',
                        highlightedSegment === index && 'bg-primary/15 text-foreground ring-1 ring-primary/30',
                      )}
                    >
                      {segment.text}{' '}
                    </span>
                  ))}
                </p>
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{rawTranscript}</p>
              )}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
