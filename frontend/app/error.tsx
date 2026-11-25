'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { RouteError } from '@/components/ui/route-error'

// Root-level safety net: catches render errors from `/` and `/login` (the
// only two routes without a more specific `error.tsx` — everything under
// /dashboard, /channels, /reports/[id], /competitors, /settings has its
// own). Renders inside `layout.tsx`'s <body>, so no <html>/<body> here.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <RouteError
          title="Something went wrong"
          description="This page hit an unexpected error."
          detail={error.message}
          onRetry={reset}
        />
      </div>
    </div>
  )
}
