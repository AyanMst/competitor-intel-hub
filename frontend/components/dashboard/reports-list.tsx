'use client'

import { FileVideo, ChevronRight, Inbox } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { listReports, ApiError } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { RouteError } from '@/components/ui/route-error'

interface ReportsListProps {
  onSelect: (id: string) => void
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function ReportsList({ onSelect }: ReportsListProps) {
  // Tanstack Query instead of a hand-rolled useEffect/useState fetch: same
  // GET /reports call as before, but now gets a real retry path (`refetch`)
  // for the error state below instead of only a full page reload.
  const {
    data: reports,
    isPending,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['reports'],
    queryFn: listReports,
  })

  return (
    <div className="mx-auto max-w-[1200px] px-5 py-6 lg:px-8 lg:py-8">
      <section className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Saved Reports</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Battlecard reports previously generated from uploaded or linked videos.
        </p>
      </section>

      <section className="mt-6">
        {isPending ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
                <Skeleton className="size-10 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <RouteError
            title="Couldn't load saved reports"
            description={error instanceof ApiError ? error.message : 'Something went wrong while fetching your reports.'}
            onRetry={() => refetch()}
            retryLabel={isFetching ? 'Retrying…' : 'Try again'}
          />
        ) : reports.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No reports saved yet"
            description="Upload a video from the Dashboard to generate and save your first battlecard."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {reports.map((report) => (
              <li key={report.id}>
                <button
                  type="button"
                  onClick={() => onSelect(report.id)}
                  className="group flex w-full items-center gap-4 rounded-xl border border-border bg-card p-4 text-left shadow-soft transition-all hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-soft-lg"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <FileVideo className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">{report.filename}</p>
                      <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                        {report.competitor_name ?? 'Uncategorized'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{formatDate(report.created_at)}</p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
