import { Sidebar } from '@/components/dashboard/sidebar'
import { Skeleton } from '@/components/ui/skeleton'

export default function CompetitorsLoading() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
        <Skeleton className="size-14 rounded-2xl" />
        <Skeleton className="mt-6 h-7 w-40" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
    </div>
  )
}
