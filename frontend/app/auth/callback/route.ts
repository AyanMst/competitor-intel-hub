// Magic Link / OAuth callback (App Router Route Handler). Required because
// the 5 beta users sign in via a Supabase Magic Link email instead of a
// password: Supabase redirects the clicked link here with a `code` query
// param, which must be exchanged server-side for a session BEFORE the user
// ever reaches a page — the browser client (lib/supabase/client.ts) can't do
// this exchange itself since the email link is opened in a fresh, unauthed
// request. On success, `exchangeCodeForSession` sets the session cookie via
// this route's `createClient()` (lib/supabase/server.ts), and
// middleware.ts's `updateSession` treats the browser as logged in from the
// very next request onward.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Mirrors the official Supabase SSR guidance: behind a load balancer /
      // reverse proxy, `origin` can be the internal address, so prefer the
      // `x-forwarded-host` header (set by the proxy) once deployed. Only
      // trusted in production — locally there is no proxy in front of
      // `next dev`, so `origin` is already correct there.
      const forwardedHost = request.headers.get('x-forwarded-host')
      const isLocalEnv = process.env.NODE_ENV === 'development'
      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`)
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`)
      } else {
        return NextResponse.redirect(`${origin}${next}`)
      }
    }
  }

  // Expired/invalid/already-used magic link — send back to /login (no
  // dedicated error page exists in this app) with `?error=expired` so it
  // can show a specific "request a new link" message instead of a generic
  // failure, since this is by far the most common way this branch is hit
  // (Supabase magic links expire quickly, and are single-use).
  return NextResponse.redirect(`${origin}/login?error=expired`)
}
