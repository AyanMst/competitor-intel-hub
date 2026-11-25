'use client'

import { RouteError } from '@/components/ui/route-error'

export default function ReportDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="mx-auto max-w-[1200px] px-5 py-6 lg:px-8 lg:py-8">
      <RouteError
        title="Couldn't load this report"
        description="Something went wrong while loading this battlecard report."
        detail={error.message}
        onRetry={reset}
      />
    </div>
  )
}
