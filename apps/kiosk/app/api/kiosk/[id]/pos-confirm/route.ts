import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateOTP, hashOTP } from '@vaultprint/lib'
import { parseKioskConfig, getSchoolOfflineMode } from '@vaultprint/lib/kiosk-config'

// ---------------------------------------------------------------------------
// POST /api/kiosk/[id]/pos-confirm — PRD C2.6
//
// ONE atomic, idempotent transition: payment_pending → queued.
// The UPDATE is guarded by:
//   id            — the job being confirmed
//   kiosk_id      — job must belong to THIS kiosk (from the API key)
//   payment_mode  — 'pos' only, can never touch a Razorpay job
//   status        — 'payment_pending', transitions exactly once, ever
//
// Zero rows updated → 409 + pos_confirm_replay_blocked audit event.
// This single statement structurally eliminates double-tap OTP
// regeneration, cross-kiosk confirmation, and POS-callback retries.
//
// The authoritative amount is total_price from the RETURNING row; the
// client-sent amount is stored for reconciliation only — a mismatch logs
// pos_amount_discrepancy (alert, don't block).
//
// The OTP is still generated and bcrypt-hashed (audit + claim invariants
// untouched). It is returned in the response ONLY when the kiosk's config
// says otp_display = "show".
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
    receipt_ref?: string
    card_last4?: string
    client_amount?: number
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { job_id, receipt_ref, card_last4, client_amount } = body

  if (!job_id) {
    return NextResponse.json({ error: 'job_id is required' }, { status: 400 })
  }

  const supabase = getAdminSupabase()

  // Kiosk config decides receipt-ref requirement and OTP display
  const { data: kiosk } = await supabase
    .from('kiosks')
    .select('config')
    .eq('id', kioskId)
    .single()

  const schoolMode = kiosk ? getSchoolOfflineMode(parseKioskConfig(kiosk.config)) : undefined

  if (schoolMode?.payment.require_receipt_ref) {
    if (!receipt_ref || !/^\d{4,10}$/.test(receipt_ref)) {
      return NextResponse.json(
        { error: 'receipt_ref (digits from the POS slip) is required' },
        { status: 400 }
      )
    }
  }

  // Generate + hash the OTP BEFORE the transition so the atomic UPDATE
  // is the single point where the job changes state.
  const plainOtp = generateOTP()
  const otpHash = await hashOTP(plainOtp)

  // ── THE atomic, idempotent transition ─────────────────────────────────
  const { data: updated, error: updateError } = await supabase
    .from('print_jobs')
    .update({
      otp_hash: otpHash,
      otp_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      status: 'queued',
      pos_transaction_ref: receipt_ref ?? null,
      pos_card_last4: card_last4 ?? null,
      pos_client_amount: client_amount ?? null,
    })
    .eq('id', job_id)
    .eq('kiosk_id', kioskId)          // job must belong to THIS kiosk
    .eq('payment_mode', 'pos')        // cannot touch Razorpay jobs
    .eq('status', 'payment_pending')  // transitions exactly once, ever
    .select('id, total_price, session_id')

  if (updateError) {
    return NextResponse.json(
      { error: 'Failed to confirm payment', details: updateError.message },
      { status: 500 }
    )
  }

  if (!updated || updated.length === 0) {
    await supabase.from('audit_log').insert({
      job_id,
      kiosk_id: kioskId,
      event: 'pos_confirm_replay_blocked',
      actor: 'kiosk_agent',
      metadata: { receipt_ref: receipt_ref ?? null },
    })
    return NextResponse.json(
      { error: 'Job is not awaiting POS confirmation (already confirmed, expired, or not a POS job)' },
      { status: 409 }
    )
  }

  const job = updated[0]

  await supabase.from('audit_log').insert({
    job_id: job.id,
    kiosk_id: kioskId,
    event: 'pos_payment_confirmed',
    actor: 'kiosk_agent',
    metadata: {
      receipt_ref: receipt_ref ?? null,
      total_price: job.total_price,
      client_amount: client_amount ?? null,
    },
  })

  // Amount reconciliation — alert, never block (PRD C2.6)
  if (
    client_amount !== undefined &&
    client_amount !== null &&
    Number(client_amount) !== Number(job.total_price)
  ) {
    await supabase.from('audit_log').insert({
      job_id: job.id,
      kiosk_id: kioskId,
      event: 'pos_amount_discrepancy',
      actor: 'kiosk_agent',
      metadata: {
        total_price: job.total_price,
        client_amount,
      },
    })
  }

  return NextResponse.json({
    success: true,
    job_id: job.id,
    total_price: job.total_price,
    // Plain OTP leaves the server ONLY for otp_display: "show" clients
    ...(schoolMode?.otp_display === 'show' ? { otp: plainOtp } : {}),
  })
}
