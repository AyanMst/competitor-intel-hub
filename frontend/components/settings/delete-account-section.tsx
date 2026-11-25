'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog } from '@base-ui/react/dialog'
import { Loader2, TriangleAlert, X } from 'lucide-react'
import { ApiError, requestAccountDeletion } from '@/lib/api'
import { createClient } from '@/lib/supabase/client'

const CONFIRMATION = 'DELETE'

/**
 * User-facing delete-my-account. The confirmation dialog is the UI gate;
 * the backend also rejects any body whose `confirmation` is not exactly
 * DELETE (config.yaml). Phase 1 only — does not hard-delete analysis_jobs.
 */
export function DeleteAccountSection() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setTyped('')
      setError(null)
      setIsSubmitting(false)
    }
  }

  async function handleConfirm() {
    if (typed !== CONFIRMATION || isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    try {
      await requestAccountDeletion(CONFIRMATION)
      const supabase = createClient()
      await supabase.auth.signOut()
      router.replace('/login')
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the account.')
      setIsSubmitting(false)
    }
  }

  return (
    <section className="rounded-2xl border border-destructive/30 bg-card p-6">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
          <TriangleAlert className="size-4 text-destructive" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">Delete account</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This signs you out immediately and schedules your account for deletion. You will not
            be able to sign back in. Existing analysis records are held for operator review
            before they are permanently removed.
          </p>
        </div>
      </div>

      <Dialog.Root open={open} onOpenChange={handleOpenChange}>
        <Dialog.Trigger className="mt-5 inline-flex h-9 items-center justify-center rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/20">
          Delete my account
        </Dialog.Trigger>

        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm" />
          <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-soft-lg outline-none">
            <div className="flex items-start justify-between gap-4">
              <Dialog.Title className="text-lg font-semibold text-foreground">
                Delete this account?
              </Dialog.Title>
              <Dialog.Close className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <X className="size-4" />
              </Dialog.Close>
            </div>
            <Dialog.Description className="mt-2 text-sm text-muted-foreground">
              Type <span className="font-mono font-semibold text-foreground">{CONFIRMATION}</span>{' '}
              to confirm. This step is required — the server will reject the request without it.
            </Dialog.Description>

            <label htmlFor="delete-account-confirm" className="mt-4 block text-sm font-medium text-foreground">
              Confirmation
            </label>
            <input
              id="delete-account-confirm"
              type="text"
              autoComplete="off"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={CONFIRMATION}
              className="mt-1.5 h-10 w-full rounded-lg border border-border bg-muted/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-foreground/30 focus:bg-card focus:ring-2 focus:ring-foreground/10 focus:outline-none"
            />

            {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground hover:bg-muted">
                Cancel
              </Dialog.Close>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={typed !== CONFIRMATION || isSubmitting}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-destructive px-3.5 text-sm font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:pointer-events-none disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                {isSubmitting ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  )
}
