import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
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

  const supabase = await getAuthenticatedSupabase()

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
