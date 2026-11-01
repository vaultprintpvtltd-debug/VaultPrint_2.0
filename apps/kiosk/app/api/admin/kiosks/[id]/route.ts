import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

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

// Service-role client WITHOUT the request cookies. Passing the admin's
// session cookie to @supabase/ssr makes PostgREST run as `authenticated`
// instead of service_role, and RLS then rejects the kiosk insert/delete.
// The admin session itself is checked separately in verifyAdminSession().
function getAuthenticatedSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

// ---------------------------------------------------------------------------
// DELETE /api/admin/kiosks/[id] — Delete a kiosk
// ---------------------------------------------------------------------------
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await verifyAdminSession()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'Kiosk ID required' }, { status: 400 })
  }

  const supabase = getAuthenticatedSupabase()

  // First check if the kiosk exists
  const { data: kiosk, error: fetchError } = await supabase
    .from('kiosks')
    .select('id, name')
    .eq('id', id)
    .single()

  if (fetchError || !kiosk) {
    return NextResponse.json({ error: 'Kiosk not found' }, { status: 404 })
  }

  // Delete the kiosk
  const { error: deleteError } = await supabase
    .from('kiosks')
    .delete()
    .eq('id', id)

  if (deleteError) {
    return NextResponse.json(
      { error: 'Failed to delete kiosk', details: deleteError.message },
      { status: 500 }
    )
  }

  // Log the deletion event
  await supabase.from('audit_log').insert({
    kiosk_id: id,
    event: 'kiosk_deleted',
    actor: 'admin',
    metadata: {
      deleted_by: user.email,
      kiosk_name: kiosk.name,
    },
  })

  return NextResponse.json({ success: true, message: 'Kiosk deleted successfully' })
}
