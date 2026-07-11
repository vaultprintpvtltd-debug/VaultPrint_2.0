import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// POST /api/kiosk/[id]/mode2/customize
//
// Saves the Mode 2 print settings chosen on the kiosk touch screen and
// moves the job to 'payment_pending'. The price is computed SERVER-SIDE
// from pricing_config and snapshotted onto the job (threat #11: the
// client can never manipulate the amount).
//
// Request: { job_id, color_mode: 'bw'|'colour', copies: 1..9, duplex: bool }
// Response: { total_price, billable_pages, price_per_page }
// ---------------------------------------------------------------------------

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: kioskId } = await params
  const headerKioskId = request.headers.get('x-kiosk-id')

  if (headerKioskId && headerKioskId !== kioskId) {
    return NextResponse.json({ error: 'Kiosk ID mismatch' }, { status: 403 })
  }

  let body: {
    job_id?: string
    color_mode?: string
    copies?: number
    duplex?: boolean
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { job_id } = body
  const colorMode = body.color_mode === 'colour' ? 'colour' : 'bw'
  const copies = Math.min(Math.max(Math.trunc(body.copies ?? 1), 1), 9)
  const duplex = Boolean(body.duplex)

  if (!job_id) {
    return NextResponse.json({ error: 'job_id is required' }, { status: 400 })
  }

  const supabase = getAdminSupabase()

  // Job must be this kiosk's live POS session, before payment
  const { data: job, error: jobError } = await supabase
    .from('print_jobs')
    .select('id, total_pages, status')
    .eq('id', job_id)
    .eq('kiosk_id', kioskId)
    .eq('payment_mode', 'pos')
    .single()

  if (jobError || !job) {
    return NextResponse.json({ error: 'Job not found for this kiosk' }, { status: 404 })
  }

  if (!['created', 'uploaded', 'customized', 'payment_pending'].includes(job.status)) {
    return NextResponse.json(
      { error: `Job is in "${job.status}" status, cannot customize` },
      { status: 409 }
    )
  }

  // ── Server-side price from pricing_config (same table as Mode 1) ──────
  const { data: pricing, error: priceError } = await supabase
    .from('pricing_config')
    .select('price_per_page')
    .eq('color_mode', colorMode)
    .eq('paper_size', 'A4')
    .eq('duplex', duplex)
    .eq('is_active', true)
    .single()

  if (priceError || !pricing) {
    return NextResponse.json(
      { error: 'No active pricing for this combination' },
      { status: 500 }
    )
  }

  const billablePages = job.total_pages ?? 1
  const pricePerPage = Number(pricing.price_per_page)
  const totalPrice = Number((billablePages * copies * pricePerPage).toFixed(2))

  const { error: updateError } = await supabase
    .from('print_jobs')
    .update({
      color_mode: colorMode,
      copies,
      duplex,
      pages_to_print: 'all',
      billable_pages: billablePages,
      price_per_page: pricePerPage,
      total_price: totalPrice,
      status: 'payment_pending',
    })
    .eq('id', job.id)
    .eq('kiosk_id', kioskId)
    .eq('payment_mode', 'pos')

  if (updateError) {
    return NextResponse.json(
      { error: 'Failed to save settings', details: updateError.message },
      { status: 500 }
    )
  }

  await supabase.from('audit_log').insert({
    job_id: job.id,
    kiosk_id: kioskId,
    event: 'pos_payment_prompted',
    actor: 'kiosk_agent',
    metadata: {
      color_mode: colorMode,
      copies,
      duplex,
      total_price: totalPrice,
    },
  })

  return NextResponse.json({
    total_price: totalPrice,
    billable_pages: billablePages,
    price_per_page: pricePerPage,
  })
}
