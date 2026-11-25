import { Skeleton } from '@/components/ui/skeleton'

// Mirrors BattlecardView's layout: back link, header card with stats grid,
// filter pills, then the pillar-card grid.
export default function ReportDetailLoading() {
  return (
    <div className="mx-auto max-w-[1200px] px-5 py-6 lg:px-8 lg:py-8">
      <Skeleton className="h-4 w-36" />

      <section className="mt-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <Skeleton className="size-16 shrink-0 rounded-2xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 border-t border-border pt-6 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-xl border border-border bg-secondary/40 p-4">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="mt-3 h-6 w-1/3" />
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="mt-2 h-4 w-80" />
        <div className="mt-4 flex flex-wrap gap-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-8 w-28 rounded-full" />
          ))}
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-2xl border border-border bg-card p-7 shadow-soft">
              <Skeleton className="h-6 w-36 rounded-full" />
              <div className="mt-4 space-y-2.5">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
