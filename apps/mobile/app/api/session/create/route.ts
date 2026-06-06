import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// ---------------------------------------------------------------------------
// POST /api/session/create
//
// Called when user scans the kiosk QR and lands on /start?k=[kioskId].
// Validates the kiosk exists and isn't offline, then creates a print_jobs
// row with status='created' and returns the session_id.
//
// Request:  { kiosk_id: string }
// Response: { session_id: string, kiosk_name: string, redirect_url: string }
// ---------------------------------------------------------------------------

async function getSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch { /* ignored in route handlers */ }
        },
      },
    }
  )
}

export async function POST(request: NextRequest) {
  let body: { kiosk_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { kiosk_id } = body

  if (!kiosk_id) {
    return NextResponse.json({ error: 'kiosk_id is required' }, { status: 400 })
  }

  const supabase = await getSupabase()

  // ── Validate kiosk exists and is not offline ──────────────────────────
  const { data: kiosk, error: kioskError } = await supabase
    .from('kiosks')
    .select('id, name, status')
    .eq('id', kiosk_id)
    .single()

  if (kioskError || !kiosk) {
    return NextResponse.json({ error: 'Kiosk not found' }, { status: 404 })
  }

  if (kiosk.status === 'offline') {
    return NextResponse.json(
      { error: 'Kiosk is currently offline. Please try again later.' },
      { status: 503 }
    )
  }

  // ── Create print_jobs row ─────────────────────────────────────────────
  const { data: job, error: jobError } = await supabase
    .from('print_jobs')
    .insert({ kiosk_id: kiosk.id, status: 'created' })
    .select('id, session_id')
    .single()

  if (jobError || !job) {
    return NextResponse.json(
      { error: 'Failed to create session', details: jobError?.message },
      { status: 500 }
    )
  }

  // ── Log the event ─────────────────────────────────────────────────────
  await supabase.from('audit_log').insert({
    job_id: job.id,
    kiosk_id: kiosk.id,
    event: 'session_created',
    actor: 'user',
    metadata: {},
  })

  return NextResponse.json({
    session_id: job.session_id,
    kiosk_name: kiosk.name,
    redirect_url: `/print/${job.session_id}`,
  }, { status: 201 })
}
