'use client'

import { RouteError } from '@/components/ui/route-error'

// Next.js requires route-level `error.tsx` to be a Client Component (it's
// a React error boundary under the hood). This page fetches via a direct
// Supabase call in a Server Component, not Tanstack Query, so `reset()` —
// the framework's own built-in retry for a failed Server Component render —
// is the equivalent of a query's `refetch()` here; nothing hand-rolled.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1200px] px-5 py-8 lg:px-8">
        <RouteError
          title="Couldn't load your dashboard"
          description="Something went wrong while loading your reports."
          detail={error.message}
          onRetry={reset}
        />
      </div>
    </div>
  )
}
