import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createRazorpayClient } from '@vaultprint/lib'

// ---------------------------------------------------------------------------
// POST /api/jobs/[id]/payment/order
//
// Creates a Razorpay order for the given print job.
// Updates job status to 'payment_pending' and stores razorpay_order_id.
//
// Response: { razorpay_order_id, amount, currency, key_id }
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
  const { id: sessionId } = await params
  const supabase = getAdminSupabase()

  // 1. Fetch job
  const { data: job, error: jobError } = await supabase
    .from('print_jobs')
    .select('id, session_id, total_price, status, razorpay_order_id')
    .eq('session_id', sessionId)
    .single()

  if (jobError || !job) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // Idempotent: if already has an order, return it
  if (job.razorpay_order_id && job.status === 'payment_pending') {
    return NextResponse.json({
      razorpay_order_id: job.razorpay_order_id,
      amount: Math.round(job.total_price * 100),
      currency: 'INR',
      key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID!,
    })
  }

  if (job.status !== 'customized') {
    return NextResponse.json(
      { error: `Cannot create order in "${job.status}" status. Customize settings first.` },
      { status: 409 }
    )
  }

  if (!job.total_price || job.total_price <= 0) {
    return NextResponse.json(
      { error: 'Total price not calculated. Save settings first.' },
      { status: 400 }
    )
  }

  // 2. Create Razorpay order
  const razorpay = createRazorpayClient()
  const amountInPaise = Math.round(job.total_price * 100)

  let order: { id: string | number }
  try {
    order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `vp_${job.id.slice(0, 8)}`,
      notes: {
        job_id: job.id,
        session_id: job.session_id,
      },
    })
  } catch (err) {
    console.error('Razorpay order creation failed:', err)
    return NextResponse.json(
      { error: 'Failed to create payment order', details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }

  // 3. Update job
  const { error: updateError } = await supabase
    .from('print_jobs')
    .update({
      razorpay_order_id: order.id,
      status: 'payment_pending',
    })
    .eq('id', job.id)

  if (updateError) {
    console.error('Failed to update job with order:', updateError)
    return NextResponse.json(
      { error: 'Failed to save order', details: updateError.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    razorpay_order_id: order.id,
    amount: amountInPaise,
    currency: 'INR',
    key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID!,
  })
}
