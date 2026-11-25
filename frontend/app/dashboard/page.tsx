import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Inbox, Radar } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { NewAnalysisButton } from '@/components/dashboard/new-analysis-button'
import { PaywallBanner } from '@/components/dashboard/paywall-banner'
import { ReportCard, type ReportCardData } from '@/components/dashboard/report-card'

// This page reads from Supabase on every request (never statically cached),
// since `NewAnalysisButton` drives fresh data in via `router.refresh()` the
// moment a new report finishes.
export const dynamic = 'force-dynamic'

interface ReportRow {
  id: string
  filename: string
  created_at: string
  competitors: { name: string } | null
}

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // middleware.ts (updateSession) already redirects unauthenticated requests
  // to /login before this Server Component ever runs — this is a
  // defense-in-depth fallback, not the primary gate.
  if (!user) {
    redirect('/login')
  }

  // Queries Supabase directly using the caller's own session (not the
  // FastAPI backend's service_role client), so the `reports` RLS policy
  // (see src/storage/schema_rls_isolation.sql) is what actually enforces
  // tenant isolation here. The explicit `.eq('user_id', ...)` below is
  // defense-in-depth on top of that RLS policy, not a substitute for it.
  const { data, error } = await supabase
    .from('reports')
    .select('id, filename, created_at, competitors(name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .returns<ReportRow[]>()

  if (error) {
    console.error('[DashboardPage] Failed to load reports:', error.message)
  }

  const reports: ReportCardData[] = (data ?? []).map((row) => ({
    id: row.id,
    filename: row.filename,
    created_at: row.created_at,
    competitor_name: row.competitors?.name ?? null,
  }))

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1200px] px-5 py-8 lg:px-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every battlecard generated from your uploaded or linked videos.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/channels"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Radar className="size-4" />
              Channels
            </Link>
            <NewAnalysisButton />
          </div>
        </div>

        <div className="mt-6">
          <PaywallBanner />
        </div>

        <div className="mt-8">
          {error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              Could not load your reports. Please refresh the page.
            </div>
          ) : reports.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center">
              <Inbox className="size-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium text-foreground">No reports yet</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Start a New Analysis above to generate your first battlecard from a YouTube video or an uploaded
                .mp4 file.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {reports.map((report) => (
                <ReportCard key={report.id} report={report} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
