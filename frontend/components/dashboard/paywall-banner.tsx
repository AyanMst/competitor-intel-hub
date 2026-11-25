'use client'

import { useEffect } from 'react'
import { CreditCard, Sparkles } from 'lucide-react'
import { trackPaywallHit } from '@/lib/analytics'
import { useEntitlement } from '@/lib/useEntitlement'

function daysRemaining(trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null
  const deadline = new Date(trialEndsAt)
  if (Number.isNaN(deadline.getTime())) return null
  return Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

/**
 * Shown above battlecard-generation surfaces when the caller is still in
 * trial (countdown) or past trial with no confirmed Stripe payment.
 * Hidden entirely while entitled.
 */
export function PaywallBanner() {
  const { entitlement, isLoading } = useEntitlement()

  const shouldShow = !isLoading && Boolean(entitlement) && !entitlement?.is_entitled

  useEffect(() => {
    if (shouldShow) trackPaywallHit('banner')
  }, [shouldShow])

  if (!shouldShow || !entitlement) {
    return null
  }

  const days = daysRemaining(entitlement.trial_ends_at)
  const expired = days === null || days <= 0
  const checkoutUrl = entitlement.checkout_url

  return (
    <div
      className={
        expired
          ? 'flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between'
          : 'flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between'
      }
    >
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary">
          <Sparkles className="size-4 text-foreground" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">
            {expired ? 'Your beta trial has ended' : `${days} day${days === 1 ? '' : 's'} left in your beta trial`}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {expired
              ? 'Upgrade to keep generating new battlecards. Existing reports stay readable.'
              : 'After the trial, new battlecard generation requires a one-time upgrade.'}
          </p>
        </div>
      </div>
      {checkoutUrl ? (
        <a
          href={checkoutUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-brand transition-all hover:-translate-y-px hover:bg-primary/90"
        >
          <CreditCard className="size-4" />
          Upgrade
        </a>
      ) : (
        <p className="text-xs text-muted-foreground sm:max-w-[14rem] sm:text-right">
          Checkout is not configured yet. Ask the operator to wire Stripe keys.
        </p>
      )}
    </div>
  )
}
