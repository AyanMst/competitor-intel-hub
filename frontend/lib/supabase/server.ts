// Server-side Supabase client for Server Components, Server Actions, and
// Route Handlers (App Router). Unlike lib/api.ts (which talks to the
// FastAPI backend, whose service_role connection bypasses RLS entirely),
// queries made with this client run as the requesting user's own session —
// RLS (see src/storage/schema_rls_isolation.sql) is the real enforcement
// boundary for anything fetched through it.
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // `setAll` was called from a Server Component, which cannot set
            // cookies on the response. Safe to ignore here because
            // middleware.ts (updateSession) already refreshes the session
            // cookie on every request.
          }
        },
      },
      // See lib/supabase/client.ts: @supabase/ssr does not infer `secure`
      // from NODE_ENV, so it's pinned here to match the cookie this same
      // session is read from/written to on the client and in middleware.
      cookieOptions: {
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  )
}
