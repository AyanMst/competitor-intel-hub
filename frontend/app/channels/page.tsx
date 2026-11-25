import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { ChannelList, type ChannelRow } from '@/components/ChannelList'

// Mutations (add/toggle/delete) call router.refresh() after every success,
// so this must never be statically cached.
export const dynamic = 'force-dynamic'

interface ChannelDbRow {
  id: string
  channel_url: string
  channel_name: string | null
  is_active: boolean
  last_checked_at: string | null
  created_at: string
  competitors: { name: string } | null
}

export default async function ChannelsPage() {
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

  // Same RLS-backed pattern as app/dashboard/page.tsx: queries Supabase
  // directly with the caller's own session, so the `tracked_channels` RLS
  // policy (see src/storage/schema_rls_isolation.sql) is what actually
  // enforces tenant isolation here — `.eq('user_id', ...)` is
  // defense-in-depth on top of it, not a substitute for it.
  const { data, error } = await supabase
    .from('tracked_channels')
    .select('id, channel_url, channel_name, is_active, last_checked_at, created_at, competitors(name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .returns<ChannelDbRow[]>()

  if (error) {
    console.error('[ChannelsPage] Failed to load channels:', error.message)
  }

  const channels: ChannelRow[] = (data ?? []).map((row) => ({
    id: row.id,
    channel_url: row.channel_url,
    channel_name: row.channel_name,
    competitor_name: row.competitors?.name ?? null,
    is_active: row.is_active,
    last_checked_at: row.last_checked_at,
    created_at: row.created_at,
  }))

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[900px] px-5 py-8 lg:px-8">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Back to Dashboard
        </Link>

        <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground">Tracked Channels</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          YouTube channels the background scheduler polls automatically for new uploads.
        </p>

        {error ? (
          <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Could not load your tracked channels. Please refresh the page.
          </div>
        ) : (
          <ChannelList initialChannels={channels} />
        )}
      </div>
    </div>
  )
}
