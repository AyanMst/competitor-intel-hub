'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { ArrowLeft, ArrowRight, Clapperboard, Radar, Sparkles, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

const STORAGE_PREFIX = 'cih:onboarding-complete:'

function subscribeNoop() {
  return () => {}
}

/**
 * True only once actually running in the browser after hydration, false on
 * the server and during the initial client render. This is the React-docs
 * -recommended way to gate client-only UI (`useSyncExternalStore` with a
 * server snapshot of `false`) — unlike the common `useState(false)` +
 * `useEffect(() => setMounted(true))` pattern, it doesn't call `setState`
 * from inside an effect (which `react-hooks/set-state-in-effect` flags),
 * and it flips before paint instead of after an extra render tick.
 */
function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  )
}

interface Step {
  icon: LucideIcon
  title: string
  description: string
}

const STEPS: Step[] = [
  {
    icon: Sparkles,
    title: 'Welcome to Competitor Intel Hub',
    description:
      'Turn competitor videos into structured competitive-intelligence battlecards — new features, pricing shifts, messaging, and risks, extracted automatically.',
  },
  {
    icon: Clapperboard,
    title: 'Start your first analysis',
    description:
      'From the Dashboard, click "New Analysis". Paste a YouTube URL or upload an .mp4, tag it with a competitor name, and we\u2019ll transcribe and analyze it for you.',
  },
  {
    icon: Radar,
    title: 'Track channels & search everything',
    description:
      'Add a competitor\u2019s YouTube channel under Channels to auto-poll new uploads, or use semantic search in the header to find any claim across every saved report.',
  },
]

/**
 * First-run onboarding (2\u20133 step modal, per the beta UX task). State is
 * entirely local: a `step` index in React state, and a "seen" flag in
 * `localStorage` keyed by the signed-in user's id so it only shows once per
 * user per browser \u2014 no new DB table, no server round trip beyond the
 * `getUser()` call every authenticated page already relies on (see
 * Sidebar's identical pattern). Mounted once in `app/layout.tsx` (rather
 * than inside `app/page.tsx`) so it shows no matter which authenticated
 * route a new beta user's magic link happens to land on, without touching
 * that page's existing state/logic at all.
 *
 * Needs `'use client'`: local step/open state, a `useEffect` auth check,
 * and `localStorage` access are all client-only.
 *
 * SSR safety: nothing here reads `window`/`localStorage` from the render
 * body — only from inside `useEffect`/event handlers, which never execute
 * during server rendering. As an explicit belt-and-suspenders guard (and to
 * keep `Dialog.Root`/`Dialog.Portal` from ever being asked to render on the
 * server at all, since portal-based UI is the classic source of SSR
 * crashes for exactly this kind of "modal added, page now 500s" bug), this
 * also renders `null` until `useIsClient()` confirms we're past hydration.
 */
export function OnboardingModal() {
  const isClient = useIsClient()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [storageKey, setStorageKey] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    let cancelled = false
    const supabase = createClient()

    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return
      const userId = data.user?.id
      if (!userId) return // Not signed in (e.g. on /login) — nothing to onboard.

      const key = `${STORAGE_PREFIX}${userId}`
      setStorageKey(key)
      const alreadySeen = window.localStorage.getItem(key)
      if (!alreadySeen) setOpen(true)
    })

    return () => {
      cancelled = true
    }
  }, [])

  function markComplete() {
    if (typeof window === 'undefined' || !storageKey) return
    window.localStorage.setItem(storageKey, '1')
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      // Dismissing early (backdrop/Escape/X) still counts as "seen" — a
      // beta user who closes it shouldn't be re-interrupted on their next
      // page load.
      markComplete()
      setStep(0)
    }
  }

  function handleNext() {
    if (step < STEPS.length - 1) {
      setStep((current) => current + 1)
      return
    }
    markComplete()
    setOpen(false)
    setStep(0)
  }

  function handleBack() {
    setStep((current) => Math.max(0, current - 1))
  }

  // Never rendered on the server (or during the initial client render
  // before hydration) — avoids handing base-ui's Dialog/Portal/Backdrop
  // anything to do until we're definitely in a real browser environment.
  if (!isClient) return null

  const current = STEPS[step]
  const isLastStep = step === STEPS.length - 1

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-soft-lg outline-none">
          <div className="flex items-center justify-between gap-4">
            <Dialog.Title className="text-lg font-semibold text-foreground">Getting started</Dialog.Title>
            <Dialog.Close className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="mt-5 flex flex-col items-center gap-4 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-foreground text-background shadow-soft">
              <current.icon className="size-6" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-foreground">{current.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{current.description}</p>
            </div>
          </div>

          {/* Step dots */}
          <div className="mt-6 flex items-center justify-center gap-1.5">
            {STEPS.map((_, index) => (
              <span
                key={index}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  index === step ? 'w-6 bg-primary' : 'w-1.5 bg-muted',
                )}
              />
            ))}
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleBack}
              disabled={step === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-0"
            >
              <ArrowLeft className="size-4" />
              Back
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-brand transition-all hover:-translate-y-px hover:bg-primary/90 active:translate-y-0"
            >
              {isLastStep ? 'Get started' : 'Next'}
              {isLastStep ? null : <ArrowRight className="size-4" />}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
