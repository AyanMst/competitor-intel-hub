import { Skeleton } from '@/components/ui/skeleton'

export default function ChannelsLoading() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[900px] px-5 py-8 lg:px-8">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-3 h-7 w-48" />
        <Skeleton className="mt-2 h-4 w-80" />

        <div className="mt-6 flex flex-col gap-6">
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
            <div className="min-w-[220px] flex-1 space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
            <div className="min-w-[160px] flex-1 space-y-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
            <Skeleton className="h-10 w-32 rounded-lg" />
          </div>

          <div className="overflow-hidden rounded-xl border border-border">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="flex items-center gap-4 border-b border-border p-4 last:border-0">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
