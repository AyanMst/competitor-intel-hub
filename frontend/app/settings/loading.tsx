import { Sidebar } from '@/components/dashboard/sidebar'
import { Skeleton } from '@/components/ui/skeleton'

export default function SettingsLoading() {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-2xl px-5 py-8 lg:px-8">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="mt-2 h-4 w-56" />
          <Skeleton className="mt-8 h-28 w-full rounded-2xl" />
          <Skeleton className="mt-6 h-36 w-full rounded-2xl" />
          <Skeleton className="mt-6 h-40 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  )
}
