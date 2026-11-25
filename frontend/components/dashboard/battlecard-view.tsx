'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  FileVideo,
  Hash,
  History,
  ShieldAlert,
  Sparkles,
  Tag,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { PillarCard } from './pillar-card'
import { pillars, pillarValue, reportHasIncompleteAnalysis, type PillarKey } from './pillar-data'
import type { ReportDetail } from '@/lib/api'

interface BattlecardViewProps {
  report: ReportDetail
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * Read-only report detail layout for `/reports/[id]` — a Server Component fetches the report, this renders it. Purpose-
 * built rather than reusing `CompetitorProfile` (the legacy `/` page's
 * upload-flow + saved-report viewer combined), since this view never has an
 * in-flight job, loading state, or upload form to account for — it always
 * has exactly one already-completed report to show. Shares `PillarCard` /
 * `pillar-data.ts` with `CompetitorProfile` so the Failure marker: badge
 * (see pillar-card.tsx) applies identically in both places.
 */
export function BattlecardView({ report }: BattlecardViewProps) {
  const [activeFilter, setActiveFilter] = useState<'All Pillars' | PillarKey>('All Pillars')
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false)
  const [highlightedSegment, setHighlightedSegment] = useState<number | null>(null)

  const visiblePillars =
    activeFilter === 'All Pillars' ? pillars : pillars.filter((pillar) => pillar.key === activeFilter)

  const wordCount = report.raw_transcript ? report.raw_transcript.trim().split(/\s+/).filter(Boolean).length : 0
  const featureCount = report.new_features.length
  const pricingMentioned = report.pricing_changes.length > 0
  const risksMentioned = report.objections_or_risks.length > 0
  const isIncomplete = reportHasIncompleteAnalysis(report)

  function handleCitationClick(timestamp: number) {
    const segments = report.raw_segments
    if (!segments || segments.length === 0) return

    let targetIndex = 0
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].start <= timestamp) targetIndex = i
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

  const stats = [
    { label: 'Words Analyzed', value: wordCount.toLocaleString(), icon: Hash },
    { label: 'Features Found', value: String(featureCount), icon: Sparkles },
    { label: 'Pricing Mentioned', value: pricingMentioned ? 'Yes' : 'No', icon: Tag },
    { label: 'Risks Flagged', value: risksMentioned ? 'Yes' : 'No', icon: ShieldAlert },
  ]

  const changes = report.changes_summary

  return (
    <div className="mx-auto max-w-[1200px] px-5 py-6 lg:px-8 lg:py-8">
      <Link
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Back to Dashboard
      </Link>

      {/* Report header */}
      <section className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-foreground text-background shadow-soft">
            <FileVideo className="size-7" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="truncate text-2xl font-bold tracking-tight text-foreground">{report.filename}</h1>
              {report.competitor_name ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
                  {report.competitor_name}
                </span>
              ) : null}
              {isIncomplete ? (
                // Failure marker: a top-level, unmissable signal
                // that this report has at least one unrecovered LLM-failure
                // chunk, in addition to the per-claim badge inside
                // PillarCard for the affected pillar(s).
                <span
                  title="One or more transcript chunks in this video could not be analyzed due to an LLM/API error. Resubmit this video from the Dashboard to retry."
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-400"
                >
                  <AlertTriangle className="size-3.5" />
                  Incomplete — retry analysis
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success/12 px-2.5 py-1 text-xs font-semibold text-success">
                  Report ready
                </span>
              )}
            </div>
            <p className="mt-3 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
              Generated {formatDate(report.created_at)}.
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

      {/* Change detection: what moved since this competitor's previous report. */}
      {changes && changes.has_changes ? (
        <section className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-soft">
          <div className="flex items-center gap-2">
            <History className="size-4 text-foreground" />
            <h2 className="text-lg font-semibold tracking-tight text-foreground">What Changed Since Last Report</h2>
          </div>
          <ul className="mt-4 flex flex-col gap-3">
            {pillars
              .filter((pillar) => {
                const value = changes[pillar.key]
                return value && value.trim().toLowerCase() !== 'no changes detected.'
              })
              .map((pillar) => (
                <li key={pillar.key} className="flex items-start gap-2.5 text-sm leading-relaxed">
                  <span className={cn('mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold', pillar.className)}>
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
            <p className="text-sm text-muted-foreground">The four B2B pillars extracted from the analyzed video.</p>
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
        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {visiblePillars.map((pillar) => (
            <PillarCard
              key={pillar.key}
              pillar={pillar}
              value={pillarValue(report, pillar.key)}
              fileName={report.filename}
              onCitationClick={handleCitationClick}
            />
          ))}
        </div>
      </section>

      {/* Raw transcript (collapsible) */}
      {report.raw_transcript ? (
        <section className="mt-8">
          <button
            type="button"
            onClick={() => setIsTranscriptOpen((open) => !open)}
            className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-5 py-3.5 text-left transition-colors hover:bg-muted/50"
          >
            <span className="text-sm font-semibold text-foreground">Raw Transcript</span>
            <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', isTranscriptOpen && 'rotate-180')} />
          </button>
          {isTranscriptOpen ? (
            <div className="mt-2 max-h-80 overflow-y-auto rounded-xl border border-border bg-secondary/30 p-5">
              {report.raw_segments && report.raw_segments.length > 0 ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {report.raw_segments.map((segment, index) => (
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
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {report.raw_transcript}
                </p>
              )}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
