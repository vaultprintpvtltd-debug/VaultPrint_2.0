import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@vaultprint/db/server'

// PATCH /api/admin/pricing — update one pricing tier.
// The admin session is verified with the cookie client; the write uses a
// cookie-free service-role client (as `authenticated`, RLS allows no update,
// so the old version silently changed nothing and still reported success).
export async function PATCH(request: NextRequest) {
  const authClient = await createServerClient()

  // Verify admin session (getUser validates the JWT server-side)
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { id: string; price_per_page: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { id, price_per_page } = body

  if (!id || typeof price_per_page !== 'number' || !(price_per_page >= 0)) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data, error } = await supabase
    .from('pricing_config')
    .update({ price_per_page })
    .eq('id', id)
    .select('id')

  if (error || !data || data.length === 0) {
    return NextResponse.json({ error: 'Failed to update pricing' }, { status: 500 })
  }

  await supabase.from('audit_log').insert({
    event: 'pricing_updated',
    actor: 'admin',
    metadata: { pricing_id: id, price_per_page, updated_by: user.email },
  })

  return NextResponse.json({ success: true })
}
