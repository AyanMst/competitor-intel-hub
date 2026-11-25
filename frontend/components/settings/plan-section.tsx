'use client'

import { CreditCard } from 'lucide-react'
import { useEntitlement } from '@/lib/useEntitlement'

function formatTrialEnd(trialEndsAt: string | null): string | null {
  if (!trialEndsAt) return null
  const date = new Date(trialEndsAt)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function PlanSection() {
  const { entitlement, isLoading, error } = useEntitlement()

  const label = entitlement?.is_entitled
    ? entitlement.entitlement_status === 'active'
      ? 'Paid'
      : 'Beta trial'
    : 'Trial ended'
  const trialEnd = formatTrialEnd(entitlement?.trial_ends_at ?? null)

  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <h2 className="text-base font-semibold text-foreground">Plan & billing</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Battlecard generation is included during the beta trial, then requires a one-time
        upgrade. Stripe test vs live keys are an operator decision — this app does not switch
        modes on its own.
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading plan…</p>
      ) : error ? (
        <p className="mt-4 text-sm text-destructive">{error}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">{label}</p>
            {trialEnd && entitlement?.entitlement_status === 'trialing' ? (
              <p className="text-xs text-muted-foreground">Trial ends {trialEnd}</p>
            ) : null}
          </div>
          {!entitlement?.is_entitled && entitlement?.checkout_url ? (
            <a
              href={entitlement.checkout_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-brand transition-all hover:-translate-y-px hover:bg-primary/90"
            >
              <CreditCard className="size-4" />
              Upgrade
            </a>
          ) : null}
        </div>
      )}
    </section>
  )
}
