import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// POST /api/webhooks/razorpay
//
// Razorpay server-to-server webhook. Verifies X-Razorpay-Signature header
// using the webhook secret (different from key_secret).
//
// Fallback for a customer whose browser never reached /payment/verify:
// records the payment and moves 'payment_pending' → 'paid' (atomic,
// idempotent). It issues no OTP — /payment/verify is the only path that
// can show one to the customer.
// ---------------------------------------------------------------------------

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

export async function POST(request: NextRequest) {
  const signature = request.headers.get('x-razorpay-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
  }

  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('RAZORPAY_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  // Read raw body for signature verification
  const rawBody = await request.text()

  // Verify webhook signature
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex')

  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  )

  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // Parse the webhook payload
  let payload: {
    event?: string
    payload?: { payment?: { entity?: { id?: string; order_id?: string } } }
  }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // We only care about payment.captured events
  if (payload.event !== 'payment.captured') {
    return NextResponse.json({ ok: true, skipped: true })
  }

  const payment = payload.payload?.payment?.entity
  if (!payment) {
    return NextResponse.json({ error: 'No payment entity in payload' }, { status: 400 })
  }

  const orderId = payment.order_id
  const paymentId = payment.id

  if (!orderId || !paymentId) {
    return NextResponse.json({ error: 'Missing order_id or payment_id' }, { status: 400 })
  }

  const supabase = getAdminSupabase()

  // Find job by razorpay_order_id
  const { data: job, error: jobError } = await supabase
    .from('print_jobs')
    .select('id, status')
    .eq('razorpay_order_id', orderId)
    .single()

  if (jobError || !job) {
    console.error('Webhook: job not found for order', orderId)
    // Return 200 to prevent Razorpay from retrying
    return NextResponse.json({ ok: true, skipped: true, reason: 'job_not_found' })
  }

  // Record the payment only. The OTP is issued by /payment/verify (the
  // one place it can be shown to the customer); the job stays 'paid' —
  // not printable — until that OTP is entered at the kiosk.
  // Atomic + idempotent: only a 'payment_pending' job transitions, so a
  // retried webhook, or one arriving after /verify, changes nothing.
  const { data: updated, error: updateError } = await supabase
    .from('print_jobs')
    .update({
      razorpay_payment_id: paymentId,
      // Window for the customer to collect a code via /verify or /recover;
      // after it the expiry cron expires the job (flagged refund_due).
      otp_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      status: 'paid',
    })
    .eq('id', job.id)
    .eq('status', 'payment_pending')
    .select('id')

  if (updateError) {
    console.error('Webhook: failed to update job:', updateError)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  if (!updated || updated.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'already_processed' })
  }

  await supabase.from('audit_log').insert({
    job_id: job.id,
    event: 'payment_verified',
    actor: 'webhook',
    metadata: { razorpay_order_id: orderId, razorpay_payment_id: paymentId },
  })

  return NextResponse.json({ ok: true })
}
