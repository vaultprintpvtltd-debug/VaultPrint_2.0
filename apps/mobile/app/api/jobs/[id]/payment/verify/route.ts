import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isValidSignature, generateOTP, hashOTP } from '@vaultprint/lib'

// ---------------------------------------------------------------------------
// POST /api/jobs/[id]/payment/verify
//
// Verifies Razorpay payment signature. On success:
//   1. Generates a 6-digit OTP
//   2. Hashes it with bcrypt
//   3. Stores hash + expiry in print_jobs
//   4. Sets status = 'paid' — the job is NOT printable yet. Only the OTP
//      entered at the kiosk releases it ('paid' → 'queued').
//   5. Returns plaintext OTP (shown once to user, never logged)
//
// One atomic UPDATE, guarded on status. It succeeds from 'payment_pending',
// or from 'paid' with no OTP yet (the Razorpay webhook got there first and
// only records the payment — it can't show an OTP to anyone). A replay
// after the OTP was issued updates zero rows → 409.
//
// Request:  { razorpay_order_id, razorpay_payment_id, razorpay_signature }
// Response: { otp, expires_at }
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

  let body: {
    razorpay_order_id?: string
    razorpay_payment_id?: string
    razorpay_signature?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return NextResponse.json(
      { error: 'razorpay_order_id, razorpay_payment_id, and razorpay_signature are required' },
      { status: 400 }
    )
  }

  // 1. Verify signature
  const valid = isValidSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)
  if (!valid) {
    console.error('[Verify] Invalid payment signature for session:', sessionId, {
      razorpay_order_id,
      razorpay_payment_id,
      signature_length: razorpay_signature.length,
      key_secret_set: !!process.env.RAZORPAY_KEY_SECRET,
    })
    return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 })
  }

  const supabase = getAdminSupabase()

  // 2. Fetch job
  const { data: job, error: jobError } = await supabase
    .from('print_jobs')
    .select('id, status, razorpay_order_id')
    .eq('session_id', sessionId)
    .single()

  if (jobError || !job) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  if (job.razorpay_order_id !== razorpay_order_id) {
    return NextResponse.json(
      { error: 'Order ID mismatch' },
      { status: 400 }
    )
  }

  // 3. Generate OTP
  const otp = generateOTP()
  const otpHash = await hashOTP(otp)
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

  // 4. Update job — atomic, guarded transition
  const { data: updated, error: updateError } = await supabase
    .from('print_jobs')
    .update({
      razorpay_payment_id,
      razorpay_signature,
      otp_hash: otpHash,
      otp_expires_at: expiresAt,
      otp_attempts: 0,
      status: 'paid',
    })
    .eq('id', job.id)
    .eq('razorpay_order_id', razorpay_order_id)
    .or('status.eq.payment_pending,and(status.eq.paid,otp_hash.is.null)')
    .select('id')

  if (updateError) {
    console.error('Failed to update job after payment:', updateError)
    return NextResponse.json(
      { error: 'Failed to process payment', details: updateError.message },
      { status: 500 }
    )
  }

  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { error: 'Payment already verified for this session' },
      { status: 409 }
    )
  }

  // 5. Audit log
  await supabase.from('audit_log').insert({
    job_id: job.id,
    event: 'payment_verified',
    actor: 'user',
    metadata: { razorpay_order_id, razorpay_payment_id },
  })

  await supabase.from('audit_log').insert({
    job_id: job.id,
    event: 'otp_generated',
    actor: 'system',
    metadata: { expires_at: expiresAt },
  })

  // Return OTP — shown once to user, never logged
  return NextResponse.json({
    otp,
    expires_at: expiresAt,
  })
}
