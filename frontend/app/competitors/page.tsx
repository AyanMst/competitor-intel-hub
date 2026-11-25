import { redirect } from 'next/navigation'
import { Radar } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/dashboard/sidebar'

// Placeholder route for the sidebar's "Competitors" link — previously a
// dead button with no destination at all. No dynamic data to fetch yet,
// so this can be statically rendered; the auth check below still runs on
// every request since Server Components always re-run on navigation.
export default async function CompetitorsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // middleware.ts (updateSession) already redirects unauthenticated requests
  // to /login before this Server Component ever runs — this is a
  // defense-in-depth fallback, matching every other page in this app.
  if (!user) {
    redirect('/login')
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-card shadow-soft">
          <Radar className="size-6 text-muted-foreground" />
        </div>
        <h1 className="mt-6 text-2xl font-bold tracking-tight text-foreground">Coming Soon</h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          We are actively working on this feature for the beta.
        </p>
      </div>
    </div>
  )
}
