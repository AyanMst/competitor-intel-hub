import { Skeleton } from '@/components/ui/skeleton'

// Pure static markup (no hooks) — stays a Server Component. Next.js renders
// this instantly on navigation while DashboardPage's Supabase query is in
// flight, mirroring its actual layout (header row + report card grid) so
// there's no visual jump once the real content swaps in.
export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1200px] px-5 py-8 lg:px-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Skeleton className="h-7 w-40" />
            <Skeleton className="mt-2 h-4 w-72" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-28 rounded-lg" />
            <Skeleton className="h-9 w-36 rounded-lg" />
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <Skeleton className="size-9 rounded-lg" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
