import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// /api/admin/kiosks — Kiosk CRUD API
//
// GET  → List all kiosks (with stats). Requires Supabase Auth session.
// POST → Create a new kiosk. Generates 32-byte random API key, SHA-256
//        hashes it for storage, and returns the plain key exactly once.
//
// Auth: Protected by middleware (Supabase Auth session check on /admin/*).
//       The /api/admin/* routes inherit this protection because the
//       middleware matcher includes '/admin/:path*'. However, since the
//       API route path is /api/admin/*, we add an explicit session check
//       here as defense-in-depth.
// ---------------------------------------------------------------------------

async function getAuthenticatedSupabase() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Ignored in Server Components / Route Handlers
          }
        },
      },
    }
  )
}

async function verifyAdminSession() {
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Ignored
          }
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// ---------------------------------------------------------------------------
// GET /api/admin/kiosks — List all kiosks
// ---------------------------------------------------------------------------
export async function GET() {
  // Defense-in-depth: verify the admin is authenticated
  const user = await verifyAdminSession()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await getAuthenticatedSupabase()

  const { data: kiosks, error } = await supabase
    .from('kiosks')
    .select('id, name, location, status, printer_name, os_platform, last_heartbeat, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json(
      { error: 'Failed to fetch kiosks', details: error.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ kiosks })
}

// ---------------------------------------------------------------------------
// POST /api/admin/kiosks — Create a new kiosk
//
// Request body: { name: string, location?: string, printer_name: string }
//
// Response: {
//   kiosk: { id, name, location, ... },
//   api_key: "plain-text-key-shown-once"
// }
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  // Defense-in-depth: verify the admin is authenticated
  const user = await verifyAdminSession()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { name?: string; location?: string; printer_name?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    )
  }

  // Validate required fields
  const { name, location, printer_name } = body

  if (!name || !name.trim()) {
    return NextResponse.json(
      { error: 'Kiosk name is required' },
      { status: 400 }
    )
  }

  if (!printer_name || !printer_name.trim()) {
    return NextResponse.json(
      { error: 'Printer name is required' },
      { status: 400 }
    )
  }

  // ── Generate API key ──────────────────────────────────────────────────
  // 32 bytes → 64-char hex string. Cryptographically secure.
  const plainApiKey = crypto.randomBytes(32).toString('hex')

  // SHA-256 hash for storage (we never store the plain key).
  const apiKeyHash = crypto
    .createHash('sha256')
    .update(plainApiKey)
    .digest('hex')

  // ── Insert kiosk row ──────────────────────────────────────────────────
  const supabase = await getAuthenticatedSupabase()

  const { data: kiosk, error } = await supabase
    .from('kiosks')
    .insert({
      name: name.trim(),
      location: location?.trim() || null,
      printer_name: printer_name.trim(),
      status: 'offline',
      api_key_hash: apiKeyHash,
      settings: {},
    })
    .select('id, name, location, status, printer_name, created_at')
    .single()

  if (error) {
    return NextResponse.json(
      { error: 'Failed to create kiosk', details: error.message },
      { status: 500 }
    )
  }

  // ── Log the creation event ────────────────────────────────────────────
  await supabase.from('audit_log').insert({
    kiosk_id: kiosk.id,
    event: 'kiosk_created',
    actor: 'admin',
    metadata: {
      created_by: user.email,
      kiosk_name: kiosk.name,
    },
  })

  // Return the kiosk data + the plain API key (shown exactly once).
  // The admin must copy this key to the kiosk PC's agent/.env file.
  return NextResponse.json(
    {
      kiosk,
      api_key: plainApiKey,
      message: 'Kiosk created. Copy the API key now — it will not be shown again.',
    },
    { status: 201 }
  )
}
