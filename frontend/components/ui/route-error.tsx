'use client'

import { useState } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'

interface RouteErrorProps {
  title?: string
  description?: string
  /** Raw error message/stack — shown behind a "Show technical details"
   * toggle, same pattern as JobProgress's failed-job card. */
  detail?: string | null
  onRetry: () => void
  retryLabel?: string
}

/**
 * Shared visual for every route-level `error.tsx` boundary in the app, plus
 * any Tanstack Query-backed view (pass `refetch` as `onRetry`). Only used
 * from within components that are already Client Components (Next.js
 * mandates `error.tsx` be a Client Component, and query-driven views need
 * hooks anyway), so this owning its own `'use client'` just documents that
 * rather than introducing a new boundary.
 */
export function RouteError({
  title = 'Something went wrong',
  description = 'This section failed to load. Your data is safe — this is just a display error.',
  detail,
  onRetry,
  retryLabel = 'Try again',
}: RouteErrorProps) {
  const [showDetails, setShowDetails] = useState(false)

  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-destructive">{title}</p>
          <p className="mt-1 text-sm leading-relaxed text-foreground/80">{description}</p>

          {detail ? (
            <>
              <button
                type="button"
                onClick={() => setShowDetails((open) => !open)}
                className="mt-2 text-xs font-medium text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
              >
                {showDetails ? 'Hide technical details' : 'Show technical details'}
              </button>
              {showDetails ? (
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-secondary/50 p-3 text-xs leading-relaxed text-muted-foreground">
                  {detail}
                </pre>
              ) : null}
            </>
          ) : null}

          <button
            type="button"
            onClick={onRetry}
            className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <RotateCw className="size-3.5" />
            {retryLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
