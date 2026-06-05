import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// ---------------------------------------------------------------------------
// Kiosk App Middleware — Three responsibilities:
//
// 1. Admin subdomain rewrite:
//    admin.vaultprintpvtltd.online/* → internal rewrite to /admin/*
//
// 2. Admin route protection:
//    /admin/* (except /admin/login) → Supabase Auth session check
//    → redirect to /admin/login if no valid session
//
// 3. Kiosk API key auth:
//    /api/kiosk/* → Bearer token → SHA-256 hash → compare kiosks.api_key_hash
//    → 403 Forbidden if missing or invalid
// ---------------------------------------------------------------------------

export async function middleware(request: NextRequest) {
  const host = request.headers.get('host') ?? ''
  const { pathname } = request.nextUrl

  // ─── 1. ADMIN SUBDOMAIN REWRITE ──────────────────────────────────────
  // If the hostname starts with "admin.", rewrite the request path to
  // /admin + original pathname. This allows admin.vaultprintpvtltd.online
  // to serve content from apps/kiosk/app/(admin)/admin/* route group.
  if (host.startsWith('admin.')) {
    // Avoid double-prefixing: if the internal path already starts with
    // /admin, let it pass through (e.g. static assets or API routes that
    // already contain /admin in the path).
    if (!pathname.startsWith('/admin')) {
      const url = request.nextUrl.clone()
      url.pathname = '/admin' + pathname
      return NextResponse.rewrite(url)
    }
  }

  // ─── 2. ADMIN ROUTE PROTECTION ───────────────────────────────────────
  // Protect all /admin/* routes EXCEPT /admin/login (which is the login
  // page itself). Requires a valid Supabase Auth session cookie.
  if (pathname.startsWith('/admin') && !pathname.startsWith('/admin/login')) {
    const response = NextResponse.next()

    // Create a Supabase client that reads/writes cookies via the
    // middleware request/response pair. This is the recommended pattern
    // for @supabase/ssr in Next.js middleware.
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            // Forward cookie changes to both the request (for downstream
            // server components) and the response (for the browser).
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            )
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    // Refresh the session (important: getUser validates the JWT server-side
    // unlike getSession which only reads the JWT without validation).
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      // No valid session — redirect to admin login page.
      const loginUrl = request.nextUrl.clone()
      loginUrl.pathname = '/admin/login'
      // Preserve the originally requested URL so we can redirect back
      // after login.
      loginUrl.searchParams.set('redirect', pathname)
      return NextResponse.redirect(loginUrl)
    }

    // Valid session — continue. Return the response so that any refreshed
    // auth cookies are forwarded to the browser.
    return response
  }

  // ─── 3. KIOSK API KEY AUTH ───────────────────────────────────────────
  // All /api/kiosk/* routes require a valid API key via
  // Authorization: Bearer <api_key>. The plain key is hashed with
  // SHA-256 and compared against the kiosks.api_key_hash column.
  if (pathname.startsWith('/api/kiosk')) {
    const authHeader = request.headers.get('authorization')

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid Authorization header. Expected: Bearer <api_key>' },
        { status: 401 }
      )
    }

    const apiKey = authHeader.slice(7).trim() // Strip "Bearer "

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key is empty' },
        { status: 401 }
      )
    }

    // SHA-256 hash the provided API key.
    const encoder = new TextEncoder()
    const data = encoder.encode(apiKey)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const apiKeyHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

    // Look up a kiosk row whose api_key_hash matches.
    // We use the service role key here (not the anon key) because
    // RLS policies should not expose api_key_hash to anonymous users.
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll() {
            // No-op: API routes don't need to set auth cookies.
          },
        },
      }
    )

    const { data: kiosk, error } = await supabase
      .from('kiosks')
      .select('id, status')
      .eq('api_key_hash', apiKeyHash)
      .single()

    if (error || !kiosk) {
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 403 }
      )
    }

    // Attach the validated kiosk ID to the request headers so that
    // downstream API route handlers can read it without re-querying.
    const response = NextResponse.next()
    response.headers.set('x-kiosk-id', kiosk.id)
    response.headers.set('x-kiosk-status', kiosk.status)
    return response
  }

  // ─── DEFAULT: PASS THROUGH ───────────────────────────────────────────
  return NextResponse.next()
}

// ---------------------------------------------------------------------------
// Matcher: Only run this middleware on admin and kiosk API routes.
// Static files, _next internals, and favicon are excluded for performance.
// ---------------------------------------------------------------------------
export const config = {
  matcher: [
    '/admin/:path*',
    '/api/kiosk/:path*',
    // Also match root for subdomain rewrite (admin. hitting /)
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
