import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/dashboard/sidebar'
import { DeleteAccountSection } from '@/components/settings/delete-account-section'
import { PlanSection } from '@/components/settings/plan-section'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-2xl px-5 py-8 lg:px-8">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">Account, plan, and data controls.</p>

          <section className="mt-8 rounded-2xl border border-border bg-card p-6">
            <h2 className="text-base font-semibold text-foreground">Account</h2>
            <p className="mt-3 text-sm text-muted-foreground">Signed in as</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">{user.email}</p>
          </section>

          <div className="mt-6">
            <PlanSection />
          </div>

          <div className="mt-6">
            <DeleteAccountSection />
          </div>

          <p className="mt-8 text-xs text-muted-foreground">
            <Link href="/privacy" className="underline-offset-4 hover:underline">
              Privacy
            </Link>
            {' · '}
            <Link href="/terms" className="underline-offset-4 hover:underline">
              Terms
            </Link>
            {' — placeholder pages, not reviewed legal copy.'}
          </p>
        </div>
      </div>
    </div>
  )
}
