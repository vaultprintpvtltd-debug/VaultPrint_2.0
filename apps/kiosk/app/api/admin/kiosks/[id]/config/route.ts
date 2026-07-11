import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { KioskConfigSchema } from '@vaultprint/lib/kiosk-config'

// ---------------------------------------------------------------------------
// GET   /api/admin/kiosks/[id]/config — read a kiosk's raw config
// PATCH /api/admin/kiosks/[id]/config — replace a kiosk's config
//
// PATCH is Zod-validated with field-level errors. The schema's refine
// guarantees standard mode is always present and enabled — the core
// product cannot be disabled through the admin, ever (PRD D5).
// Middleware already guards /api/admin/*; we re-verify in-handler
// (defense in depth, matching existing admin routes).
// ---------------------------------------------------------------------------

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

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await verifyAdminSession()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const supabase = getAdminSupabase()

  const { data: kiosk, error } = await supabase
    .from('kiosks')
    .select('id, name, config')
    .eq('id', id)
    .single()

  if (error || !kiosk) {
    return NextResponse.json({ error: 'Kiosk not found' }, { status: 404 })
  }

  return NextResponse.json({ config: kiosk.config })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await verifyAdminSession()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const rawConfig = (body as { config?: unknown })?.config
  if (rawConfig === undefined) {
    return NextResponse.json(
      { error: 'Request body must be { config: {...} }' },
      { status: 400 }
    )
  }

  // ── Zod validation with field-level errors ─────────────────────────────
  const result = KioskConfigSchema.safeParse(rawConfig)
  if (!result.success) {
    return NextResponse.json(
      {
        error: 'Invalid kiosk config',
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      { status: 400 }
    )
  }

  const supabase = getAdminSupabase()

  const { data: kiosk, error: fetchError } = await supabase
    .from('kiosks')
    .select('id, name')
    .eq('id', id)
    .single()

  if (fetchError || !kiosk) {
    return NextResponse.json({ error: 'Kiosk not found' }, { status: 404 })
  }

  const { error: updateError } = await supabase
    .from('kiosks')
    .update({ config: result.data })
    .eq('id', id)

  if (updateError) {
    return NextResponse.json(
      { error: 'Failed to update config', details: updateError.message },
      { status: 500 }
    )
  }

  await supabase.from('audit_log').insert({
    kiosk_id: id,
    event: 'kiosk_config_updated',
    actor: 'admin',
    metadata: {
      updated_by: user.email,
      enabled_modes: result.data.modes.filter((m) => m.enabled).map((m) => m.id),
    },
  })

  return NextResponse.json({ success: true, config: result.data })
}
