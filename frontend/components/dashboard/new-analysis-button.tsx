'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog } from '@base-ui/react/dialog'
import { Link2, Plus, UploadCloud, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { trackFirstBattlecardGenerated, trackPaywallHit } from '@/lib/analytics'
import { analyzeVideoFile, analyzeVideoUrl, ApiError, PaymentRequiredError, type AnalyzeJobResponse } from '@/lib/api'
import { useEntitlement } from '@/lib/useEntitlement'
import { useAnalysisJob } from '@/lib/useAnalysisJob'
import { JobProgress, type JobPhase } from './job-progress'

type InputMode = 'youtube' | 'upload'

// After a job reaches 'completed', keep the success state in JobProgress on
// screen for a beat before the modal dismisses itself, instead of closing
// the instant `router.refresh()` fires.
const AUTO_CLOSE_DELAY_MS = 1400

/**
 * Dashboard "New Analysis" entry point.
 *
 * Opens a modal where the user submits a YouTube URL or uploads an .mp4,
 * hits the same POST /analyze(-video) enqueue-only endpoints as the legacy
 * `/` page (via `apiFetch`-backed `lib/api.ts` helpers), then hands the
 * returned `job_id` to the existing `useAnalysisJob` Realtime hook to drive
 * the same 4-state `JobProgress` indicator. On completion, `router.refresh()`
 * re-runs the dashboard's Server Component so the new report appears in the
 * grid without a full page reload.
 */
export function NewAnalysisButton() {
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [inputMode, setInputMode] = useState<InputMode>('youtube')
  const [competitor, setCompetitor] = useState('')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false) // initial POST /analyze(-video) in flight
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  // Set when the enqueue response is already `job_status: 'completed'` (a
  // duplicate of a prior identical request, see api.py's create_or_get_job)
  // — there's no job left to track via Realtime, but the success state
  // should still show briefly before auto-closing.
  const [completedImmediately, setCompletedImmediately] = useState(false)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)
  const { entitlement } = useEntitlement()
  const analysisLocked = entitlement !== null && !entitlement.is_entitled

  const fileInputRef = useRef<HTMLInputElement>(null)
  const autoCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const trimmedCompetitor = competitor.trim()
  const trimmedUrl = youtubeUrl.trim()
  const canSubmit = Boolean(trimmedCompetitor) && (inputMode === 'youtube' ? Boolean(trimmedUrl) : Boolean(file))

  function clearAutoCloseTimer() {
    if (autoCloseTimer.current) {
      clearTimeout(autoCloseTimer.current)
      autoCloseTimer.current = null
    }
  }

  function scheduleAutoClose() {
    clearAutoCloseTimer()
    autoCloseTimer.current = setTimeout(() => setOpen(false), AUTO_CLOSE_DELAY_MS)
  }

  useEffect(() => clearAutoCloseTimer, [])

  // Realtime hand-off: as soon as the tracked job reports 'completed',
  // refresh the dashboard grid (the new `reports` row already exists in
  // Supabase by then) and start the auto-close countdown.
  const job = useAnalysisJob(activeJobId, (updatedJob) => {
    if (updatedJob.status === 'completed') {
      void trackFirstBattlecardGenerated()
      router.refresh()
      scheduleAutoClose()
    }
  })

  const activeJobView =
    isSubmitting || activeJobId || completedImmediately
      ? {
          phase: (completedImmediately ? 'completed' : isSubmitting ? 'uploading' : (job?.status ?? 'pending')) as JobPhase,
          currentStep: job?.current_step ?? null,
          errorMessage: job?.error_message ?? null,
        }
      : null

  function resetForm() {
    setInputMode('youtube')
    setCompetitor('')
    setYoutubeUrl('')
    setFile(null)
    setIsSubmitting(false)
    setSubmitError(null)
    setActiveJobId(null)
    setCompletedImmediately(false)
    setCheckoutUrl(null)
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      clearAutoCloseTimer()
      // Always reopen to a clean form, regardless of how the previous run
      // ended (success, failure, or abandoned mid-submit).
      resetForm()
    }
  }

  function handleDismissFailedJob() {
    setActiveJobId(null)
    setSubmitError(null)
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setSubmitError(null)
    setIsSubmitting(true)

    try {
      const submit = (): Promise<AnalyzeJobResponse> =>
        inputMode === 'youtube'
          ? analyzeVideoUrl(trimmedUrl, trimmedCompetitor)
          : analyzeVideoFile(file as File, trimmedCompetitor)

      const response = await submit()

      if (response.job_status === 'completed' && response.result_report_id) {
        setCompletedImmediately(true)
        void trackFirstBattlecardGenerated()
        router.refresh()
        scheduleAutoClose()
      } else {
        setActiveJobId(response.job_id)
      }
    } catch (err) {
      if (err instanceof PaymentRequiredError) {
        trackPaywallHit('generate')
        setSubmitError(err.message)
        setCheckoutUrl(err.checkoutUrl)
      } else {
        setSubmitError(err instanceof ApiError ? err.message : 'Unexpected error while starting the analysis.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-brand transition-all hover:-translate-y-px hover:bg-primary/90 active:translate-y-0">
        <Plus className="size-[18px]" />
        New Analysis
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-soft-lg outline-none">
          <div className="flex items-center justify-between gap-4">
            <Dialog.Title className="text-lg font-semibold text-foreground">New Analysis</Dialog.Title>
            <Dialog.Close className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          {analysisLocked && !activeJobView ? (
            <div className="mt-5 flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Your beta trial has ended. Upgrade to generate new battlecards. Existing reports
                stay readable.
              </p>
              {entitlement?.checkout_url ? (
                <a
                  href={entitlement.checkout_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-brand transition-all hover:-translate-y-px hover:bg-primary/90"
                >
                  Upgrade
                </a>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Checkout is not configured yet. Ask the operator to wire Stripe keys.
                </p>
              )}
            </div>
          ) : activeJobView ? (
            <JobProgress
              phase={activeJobView.phase}
              currentStep={activeJobView.currentStep}
              errorMessage={activeJobView.errorMessage}
              onDismiss={activeJobView.phase === 'failed' ? handleDismissFailedJob : undefined}
            />
          ) : (
            <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
              <div className="flex rounded-lg border border-border bg-muted/50 p-1">
                <button
                  type="button"
                  onClick={() => setInputMode('youtube')}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-colors',
                    inputMode === 'youtube'
                      ? 'bg-card text-foreground shadow-soft'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Link2 className="size-4" />
                  YouTube URL
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('upload')}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium transition-colors',
                    inputMode === 'upload'
                      ? 'bg-card text-foreground shadow-soft'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <UploadCloud className="size-4" />
                  Upload Video
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="new-analysis-competitor" className="text-sm font-medium text-foreground">
                  Competitor name
                </label>
                <input
                  id="new-analysis-competitor"
                  type="text"
                  required
                  placeholder="e.g. Acme Corp"
                  value={competitor}
                  onChange={(event) => setCompetitor(event.target.value)}
                  className="h-10 rounded-lg border border-border bg-muted/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:bg-card focus:ring-2 focus:ring-foreground/10 focus:outline-none"
                />
              </div>

              {inputMode === 'youtube' ? (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="new-analysis-url" className="text-sm font-medium text-foreground">
                    YouTube URL
                  </label>
                  <input
                    id="new-analysis-url"
                    type="url"
                    required
                    placeholder="https://www.youtube.com/watch?v=…"
                    value={youtubeUrl}
                    onChange={(event) => setYoutubeUrl(event.target.value)}
                    className="h-10 rounded-lg border border-border bg-muted/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:bg-card focus:ring-2 focus:ring-foreground/10 focus:outline-none"
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-foreground">Video file</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".mp4,video/mp4"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-10 items-center gap-2 rounded-lg border border-dashed border-border bg-muted/50 px-3 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                  >
                    <UploadCloud className="size-4 shrink-0" />
                    <span className="truncate">{file ? file.name : 'Choose an .mp4 file…'}</span>
                  </button>
                </div>
              )}

              {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
              {checkoutUrl ? (
                <a
                  href={checkoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  Upgrade to continue
                </a>
              ) : null}

              <button
                type="submit"
                disabled={!canSubmit || isSubmitting}
                className="mt-1 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-brand transition-all hover:-translate-y-px hover:bg-primary/90 active:translate-y-0 disabled:pointer-events-none disabled:opacity-60"
              >
                Start Analysis
              </button>
            </form>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
