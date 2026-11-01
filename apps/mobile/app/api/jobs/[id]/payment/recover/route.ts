import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createRazorpayClient, generateOTP, hashOTP } from '@vaultprint/lib'

// ---------------------------------------------------------------------------
// POST /api/jobs/[id]/payment/recover
//
// Issues the customer's OTP when the browser never completed
// /payment/verify — on mobile, UPI often leaves for a UPI app or reloads the
// page, so Razorpay's checkout `handler` callback (the only caller of
// /verify) is lost. The payment is then confirmed SERVER-SIDE by asking
// Razorpay for the order's captured payments; no client signature needed.
//
// Issues an OTP only while none has been issued (same rule as /verify), so
// a code can never be regenerated once shown.
//
// Response: { otp, expires_at }      — code issued
//           { paid: false }          — Razorpay has no captured payment yet
//           409                      — code already issued / job released
// ---------------------------------------------------------------------------

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

interface RazorpayPayment {
  id: string
  status: string
  amount: number | string
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params
  const supabase = getAdminSupabase()

  const { data: job, error: jobError } = await supabase
    .from('print_jobs')
    .select('id, kiosk_id, status, razorpay_order_id, razorpay_payment_id, otp_hash, total_price')
    .eq('session_id', sessionId)
    .single()

  if (jobError || !job) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const needsCode =
    job.status === 'payment_pending' || (job.status === 'paid' && !job.otp_hash)

  if (!needsCode) {
    return NextResponse.json(
      { error: `No code can be issued in "${job.status}" status` },
      { status: 409 }
    )
  }

  if (!job.razorpay_order_id) {
    return NextResponse.json({ paid: false })
  }

  // ── Ask Razorpay whether this order is actually paid ──────────────────
  let paymentId: string | null = job.razorpay_payment_id
  if (job.status === 'payment_pending' || !paymentId) {
    try {
      const razorpay = createRazorpayClient()
      const result = (await razorpay.orders.fetchPayments(job.razorpay_order_id)) as {
        items?: RazorpayPayment[]
      }
      const expectedPaise = Math.round(Number(job.total_price) * 100)
      const captured = (result.items ?? []).find(
        (p) => p.status === 'captured' && Number(p.amount) >= expectedPaise
      )
      if (!captured) return NextResponse.json({ paid: false })
      paymentId = captured.id
    } catch (err) {
      console.error('[Recover] Razorpay fetchPayments failed:', err)
      return NextResponse.json({ error: 'Could not confirm payment right now' }, { status: 502 })
    }
  }

  // ── Issue the OTP — atomic, same guard as /verify ─────────────────────
  const otp = generateOTP()
  const otpHash = await hashOTP(otp)
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

  const { data: updated, error: updateError } = await supabase
    .from('print_jobs')
    .update({
      razorpay_payment_id: paymentId,
      otp_hash: otpHash,
      otp_expires_at: expiresAt,
      otp_attempts: 0,
      status: 'paid',
    })
    .eq('id', job.id)
    .or('status.eq.payment_pending,and(status.eq.paid,otp_hash.is.null)')
    .select('id')

  if (updateError) {
    return NextResponse.json({ error: 'Failed to issue code' }, { status: 500 })
  }

  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Code already issued for this session' }, { status: 409 })
  }

  if (job.status === 'payment_pending') {
    await supabase.from('audit_log').insert({
      job_id: job.id,
      kiosk_id: job.kiosk_id,
      event: 'payment_verified',
      actor: 'system',
      metadata: { razorpay_order_id: job.razorpay_order_id, razorpay_payment_id: paymentId, via: 'recover' },
    })
  }

  await supabase.from('audit_log').insert({
    job_id: job.id,
    kiosk_id: job.kiosk_id,
    event: 'otp_generated',
    actor: 'system',
    metadata: { expires_at: expiresAt, via: 'recover' },
  })

  return NextResponse.json({ otp, expires_at: expiresAt })
}
