'use client'

import { Sidebar } from '@/components/dashboard/sidebar'
import { RouteError } from '@/components/ui/route-error'

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <RouteError
            title="Couldn't load this page"
            description="Something went wrong."
            detail={error.message}
            onRetry={reset}
          />
        </div>
      </div>
    </div>
  )
}
