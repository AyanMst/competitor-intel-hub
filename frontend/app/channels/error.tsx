'use client'

import { RouteError } from '@/components/ui/route-error'

export default function ChannelsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[900px] px-5 py-8 lg:px-8">
        <RouteError
          title="Couldn't load tracked channels"
          description="Something went wrong while loading your tracked channels."
          detail={error.message}
          onRetry={reset}
        />
      </div>
    </div>
  )
}
