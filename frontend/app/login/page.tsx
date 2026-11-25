'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Sparkles, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

// Magic Link Failures: app/auth/callback/route.ts
// redirects here with `?error=expired` when `exchangeCodeForSession` fails
// (the link was expired, already used, or otherwise invalid). Split into a
// wrapper + inner component because `useSearchParams` requires a `Suspense`
// boundary in the App Router, and this page is otherwise eligible for
// static rendering.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const linkExpired = searchParams.get('error') === 'expired'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setIsLoading(true)
    setError(null)

    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      setError(signInError.message)
      setIsLoading(false)
      return
    }

    router.replace('/')
    router.refresh()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2.5">
          <div className="flex size-10 items-center justify-center rounded-lg bg-foreground shadow-soft">
            <Sparkles className="size-5 text-background" />
          </div>
          <div className="flex flex-col items-center leading-none">
            <span className="text-base font-semibold tracking-tight text-foreground">Competitor Intel Hub</span>
            <span className="text-[11px] font-medium text-muted-foreground">Video Intelligence Hub</span>
          </div>
        </div>

        {linkExpired ? (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            Link expired. Request a new one.
          </div>
        ) : null}

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6 shadow-soft"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium text-foreground">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-10 rounded-lg border border-border bg-muted/50 px-3 text-sm text-foreground focus:border-foreground/30 focus:bg-card focus:outline-none focus:ring-2 focus:ring-foreground/10"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium text-foreground">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-10 rounded-lg border border-border bg-muted/50 px-3 text-sm text-foreground focus:border-foreground/30 focus:bg-card focus:outline-none focus:ring-2 focus:ring-foreground/10"
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <button
            type="submit"
            disabled={isLoading}
            className="mt-2 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-brand transition-all hover:-translate-y-px hover:bg-primary/90 active:translate-y-0 disabled:pointer-events-none disabled:opacity-60"
          >
            {isLoading ? <Loader2 className="size-4 animate-spin" /> : null}
            {isLoading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link href="/privacy" className="underline-offset-4 hover:underline">
            Privacy
          </Link>
          {' · '}
          <Link href="/terms" className="underline-offset-4 hover:underline">
            Terms
          </Link>
        </p>
      </div>
    </div>
  )
}
