// Runs on every request via middleware.ts: refreshes the Supabase session
// cookie and gates access to the dashboard behind a logged-in user.
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
      // See lib/supabase/client.ts: @supabase/ssr does not infer `secure`
      // from NODE_ENV, so it's pinned here to match the cookie this same
      // session is read from/written to on the client and in Server Components.
      cookieOptions: {
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const isLoginPage = pathname.startsWith('/login')
  const isPublicLegalPage = pathname === '/privacy' || pathname === '/terms'

  if (!user && !isLoginPage && !isPublicLegalPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && isLoginPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
