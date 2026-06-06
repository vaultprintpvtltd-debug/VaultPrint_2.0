import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@vaultprint/db/server'

export async function PATCH(request: NextRequest) {
  const supabase = await createServerClient()
  
  // Verify admin session
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { id: string; price_per_page: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { id, price_per_page } = body

  if (!id || typeof price_per_page !== 'number') {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const { error } = await (supabase as any)
    .from('pricing_config')
    .update({ price_per_page })
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: 'Failed to update pricing' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
