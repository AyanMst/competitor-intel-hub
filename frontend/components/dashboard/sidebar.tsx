'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  Radar,
  Settings,
  Sparkles,
  ShieldCheck,
  LogOut,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useEntitlement } from '@/lib/useEntitlement'

export type DashboardView = 'dashboard' | 'reports'

// Dashboard/Reports stay as in-page view switches (not real navigations):
// they live inside the same single-page app at `/` that also tracks live
// job progress via Supabase Realtime while a video is analyzing, and a real
// route change between them would remount that whole tree — losing an
// in-flight job's live progress UI — for no real benefit, since both are
// already fully working today. Competitors/Settings, on the other hand,
// were completely dead (no `view`, no href, onClick did nothing) — those
// get real routes instead, since there's no shared state to lose by
// navigating away from `/` entirely.
type NavItem =
  | { label: string; icon: typeof LayoutDashboard; view: DashboardView }
  | { label: string; icon: typeof LayoutDashboard; href: string }

const navItems: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, view: 'dashboard' },
  { label: 'Reports', icon: Users, view: 'reports' },
  { label: 'Competitors', icon: Radar, href: '/competitors' },
  { label: 'Settings', icon: Settings, href: '/settings' },
]

interface SidebarProps {
  // Optional: only meaningful (and only ever passed) from app/page.tsx,
  // the one place Dashboard/Reports' in-page view-switch actually applies.
  // Rendered without them on standalone routes like /competitors and
  // /settings, where Dashboard/Reports simply link back to `/`.
  activeView?: DashboardView
  onNavigate?: (view: DashboardView) => void
}

export function Sidebar({ activeView, onNavigate }: SidebarProps) {
  const router = useRouter()
  const pathname = usePathname()

  // Sidebar Profile fix: no more hardcoded "Ava Mercer" / "Acme Corp" — read
  // the real signed-in user off the same browser Supabase client the
  // sign-out button below already uses. `null` while the initial
  // `getUser()` call is in flight (brief, since middleware.ts already
  // guarantees a session exists by the time this page is reachable).
  const [email, setEmail] = useState<string | null>(null)
  const { entitlement } = useEntitlement()

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setEmail(data.user?.email ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/login')
    router.refresh()
  }

  const avatarInitial = email ? email[0].toUpperCase() : '?'

  return (
    // Profile section CSS fix: pinned to the viewport (`sticky top-0
    // h-screen`) instead of stretching to match the height of whatever's
    // in the main content column — previously, long report content made
    // this whole column taller than the viewport, and the browser's own
    // handling of that mismatch is what let the avatar circle and footer
    // text visually overlap mid-scroll. Now the sidebar never moves or
    // resizes as the page scrolls, so there's nothing for it to overlap.
    <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:sticky lg:top-0 lg:flex lg:h-screen">
      {/* Brand */}
      <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-sidebar-border px-5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-foreground shadow-soft">
          <Sparkles className="size-4 text-background" />
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-sm font-semibold tracking-tight text-foreground">Competitor Intel Hub</span>
          <span className="text-[11px] font-medium text-muted-foreground">Video Intelligence Hub</span>
        </div>
      </div>

      {/* Nav — scrolls internally (its own overflow-y-auto) instead of
          growing the whole `<aside>` taller than the viewport, which is
          what used to push the Enterprise badge / Account footer below it
          around unpredictably. */}
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-5">
        <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Workspace
        </p>
        {navItems.map((item) => {
          // Route-based items (Competitors/Settings) are active purely by
          // URL, same as any normal link. View-based items (Dashboard/
          // Reports) only ever apply while actually on `/` — otherwise
          // (e.g. sitting on /competitors) neither should read as active
          // just because `activeView` defaulted to 'dashboard'.
          const isActive = 'href' in item ? pathname === item.href : pathname === '/' && item.view === activeView

          const itemClassName = cn(
            'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
            isActive
              ? 'bg-secondary text-foreground'
              : 'text-sidebar-foreground hover:bg-secondary/60 hover:text-foreground',
          )

          const iconAndLabel = (
            <>
              <item.icon
                className={cn(
                  'size-[18px] transition-colors',
                  isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground',
                )}
              />
              {item.label}
              {isActive ? <span className="ml-auto h-4 w-1 rounded-full bg-foreground" /> : null}
            </>
          )

          if ('href' in item) {
            return (
              <Link key={item.label} href={item.href} className={itemClassName} aria-current={isActive ? 'page' : undefined}>
                {iconAndLabel}
              </Link>
            )
          }

          return (
            <button
              key={item.label}
              type="button"
              onClick={() => (onNavigate ? onNavigate(item.view) : router.push('/'))}
              className={itemClassName}
              aria-current={isActive ? 'page' : undefined}
            >
              {iconAndLabel}
            </button>
          )
        })}
      </nav>

      {/* Enterprise badge — shrink-0 so it always keeps its natural size
          instead of ever being compressed by its flex siblings. */}
      <div className="shrink-0 px-3 pb-3">
        <div className="flex items-center gap-2.5 rounded-xl border border-sidebar-border bg-secondary/60 px-3 py-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-card shadow-soft">
            <ShieldCheck className="size-4 text-foreground" />
          </div>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="text-xs font-semibold text-foreground">
              {entitlement?.is_entitled
                ? entitlement.entitlement_status === 'active'
                  ? 'Paid plan'
                  : 'Beta trial'
                : entitlement
                  ? 'Trial ended'
                  : 'Plan'}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {entitlement?.is_entitled
                ? entitlement.entitlement_status === 'active'
                  ? 'Battlecard generation unlocked'
                  : 'Trial access'
                : entitlement
                  ? 'Upgrade to generate'
                  : 'Loading…'}
            </span>
          </div>
        </div>
      </div>

      {/* Account — `shrink-0` keeps this footer at its natural height,
          `relative z-10` + an opaque `bg-sidebar` guarantee it always
          paints above (and is never bled into by) anything above it,
          regardless of how the nav list above scrolls or resizes. */}
      <div className="relative z-10 shrink-0 border-t border-sidebar-border bg-sidebar p-3">
        <button
          type="button"
          onClick={handleSignOut}
          className="group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-sidebar-accent/60"
        >
          {/* `shrink-0` is the key fix here: without it, this circle could
              be compressed by its flex siblings and let the truncated
              email text next to it visually bleed over/into it. */}
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
            {avatarInitial}
          </div>
          <div className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-sm font-medium text-foreground">{email ?? 'Loading…'}</span>
          </div>
          <LogOut className="ml-auto size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
        </button>
      </div>
    </aside>
  )
}
