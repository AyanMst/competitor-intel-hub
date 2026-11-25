'use client'

import { useState } from 'react'
import { CheckCircle2, Loader2, Sparkles, UploadCloud, Waves, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { JobStatus } from '@/lib/api'

// 'uploading' is a client-only phase: the initial POST /analyze(-video)
// request is still in flight and no `analysis_jobs` row exists yet to
// track. Every other value is a real `analysis_jobs.status`.
export type JobPhase = 'uploading' | JobStatus

const STEPS: { phase: JobPhase; label: string; icon: typeof UploadCloud }[] = [
  { phase: 'pending', label: 'Queued', icon: UploadCloud },
  { phase: 'transcribing', label: 'Transcribing', icon: Waves },
  { phase: 'analyzing', label: 'Analyzing', icon: Sparkles },
  { phase: 'completed', label: 'Done', icon: CheckCircle2 },
]

const STEP_INDEX: Record<JobPhase, number> = {
  uploading: 0,
  pending: 0,
  transcribing: 1,
  analyzing: 2,
  completed: 3,
  failed: 3,
}

const DEFAULT_STEP_LABEL: Record<JobPhase, string> = {
  uploading: 'Uploading to server…',
  pending: 'Queued for analysis…',
  transcribing: 'Transcribing audio…',
  analyzing: 'Extracting battlecard insights…',
  completed: 'Done',
  failed: 'Failed',
}

/**
 * Takes the last non-empty line of a Python traceback (the actual exception
 * message) so the failed state shows something readable by default. The
 * full traceback — stored verbatim in `analysis_jobs.error_message` by
 * job_worker._run_job — stays available behind "Show technical details".
 */
function summarizeError(message: string): string {
  const lines = message.trim().split('\n').filter(Boolean)
  return lines[lines.length - 1] ?? message
}

interface JobProgressProps {
  phase: JobPhase
  currentStep?: string | null
  errorMessage?: string | null
  onDismiss?: () => void
}

export function JobProgress({ phase, currentStep, errorMessage, onDismiss }: JobProgressProps) {
  const [showDetails, setShowDetails] = useState(false)

  if (phase === 'failed') {
    return (
      <div className="mt-5 rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <XCircle className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-destructive">Analysis failed</p>
            <p className="mt-1 text-sm leading-relaxed text-foreground/80">
              {errorMessage
                ? summarizeError(errorMessage)
                : 'An unexpected error occurred while processing this video.'}
            </p>
            {errorMessage ? (
              <>
                <button
                  type="button"
                  onClick={() => setShowDetails((open) => !open)}
                  className="mt-2 text-xs font-medium text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
                >
                  {showDetails ? 'Hide technical details' : 'Show technical details'}
                </button>
                {showDetails ? (
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-secondary/50 p-3 text-xs leading-relaxed text-muted-foreground">
                    {errorMessage}
                  </pre>
                ) : null}
              </>
            ) : null}
            {onDismiss ? (
              <button
                type="button"
                onClick={onDismiss}
                className="mt-4 inline-flex h-8 items-center justify-center rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Dismiss
              </button>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  const activeIndex = STEP_INDEX[phase]
  const isCompleted = phase === 'completed'

  return (
    <div className="mt-5 rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-semibold text-foreground">
          {isCompleted ? 'Analysis complete' : 'Analyzing video'}
        </p>
        <p className="text-xs text-muted-foreground">{currentStep || DEFAULT_STEP_LABEL[phase]}</p>
      </div>

      <div className="mt-5 flex items-center">
        {STEPS.map((step, index) => {
          const done = isCompleted || index < activeIndex
          const active = !isCompleted && index === activeIndex
          const Icon = step.icon

          return (
            <div key={step.phase} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-2">
                <span
                  className={cn(
                    'flex size-9 items-center justify-center rounded-full border transition-colors',
                    done
                      ? 'border-success/30 bg-success/12 text-success'
                      : active
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-border bg-secondary/50 text-muted-foreground',
                  )}
                >
                  {active ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : done ? (
                    <CheckCircle2 className="size-4" />
                  ) : (
                    <Icon className="size-4" />
                  )}
                </span>
                <span
                  className={cn(
                    'text-xs font-medium',
                    done || active ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {step.label}
                </span>
              </div>
              {index < STEPS.length - 1 ? (
                <div
                  className={cn(
                    'mx-2 h-px flex-1 rounded-full transition-colors',
                    done ? 'bg-success/40' : 'bg-border',
                  )}
                />
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
