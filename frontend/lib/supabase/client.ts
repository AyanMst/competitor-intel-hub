// Browser-side Supabase client, used for the login form and for reading the
// current session's access token to attach to FastAPI requests.
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // @supabase/ssr defaults to `secure: undefined` (attribute omitted) and
      // does not set it based on NODE_ENV itself, so it must be pinned here
      // explicitly. `httpOnly` is intentionally left at the library default
      // (false): this client reads/writes the session cookie directly via
      // `document.cookie`, so it cannot function with an httpOnly cookie.
      cookieOptions: {
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  )
}
