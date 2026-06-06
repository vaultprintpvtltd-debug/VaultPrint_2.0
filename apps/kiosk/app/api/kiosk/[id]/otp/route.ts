import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOTP } from '@vaultprint/lib'

// ---------------------------------------------------------------------------
// POST /api/kiosk/[id]/otp
//
// Kiosk submits OTP entered by user. Middleware has already validated
// the API key and set x-kiosk-id header.
//
// Request:  { session_id: string, otp: string }
// Response: { valid: boolean, attempts_remaining: number, reason?: string }
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

  // Verify the kiosk ID from the URL matches the authenticated kiosk
  if (headerKioskId && headerKioskId !== kioskId) {
    return NextResponse.json({ error: 'Kiosk ID mismatch' }, { status: 403 })
  }

  let body: { session_id?: string; otp?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { session_id, otp } = body

  if (!session_id || !otp) {
    return NextResponse.json(
      { error: 'session_id and otp are required' },
      { status: 400 }
    )
  }

  if (otp.length !== 6 || !/^\d{6}$/.test(otp)) {
    return NextResponse.json(
      { error: 'OTP must be exactly 6 digits' },
      { status: 400 }
    )
  }

  const supabase = getAdminSupabase()

  // Find the queued job for this kiosk
  const { data: job, error: jobError } = await supabase
    .from('print_jobs')
    .select('id, otp_hash, otp_expires_at, otp_attempts, status')
    .eq('session_id', session_id)
    .eq('kiosk_id', kioskId)
    .single()

  if (jobError || !job) {
    return NextResponse.json({ error: 'Job not found for this kiosk' }, { status: 404 })
  }

  if (!['queued', 'paid'].includes(job.status)) {
    return NextResponse.json(
      { error: `Job is in "${job.status}" status, cannot verify OTP` },
      { status: 409 }
    )
  }

  if (!job.otp_hash || !job.otp_expires_at) {
    return NextResponse.json({ error: 'No OTP set for this job' }, { status: 400 })
  }

  // Verify OTP
  const result = await verifyOTP(otp, job.otp_hash, job.otp_expires_at, job.otp_attempts)

  if (result.valid) {
    // OTP correct — leave as queued, agent will claim it
    await supabase.from('audit_log').insert({
      job_id: job.id,
      kiosk_id: kioskId,
      event: 'otp_verified',
      actor: 'kiosk_agent',
      metadata: {},
    })

    return NextResponse.json({
      valid: true,
      attempts_remaining: 3 - job.otp_attempts,
    })
  }

  // OTP wrong — increment attempts
  const newAttempts = job.otp_attempts + 1

  if (newAttempts >= 3 || result.reason === 'expired' || result.reason === 'max_attempts') {
    // Expire the job
    await supabase
      .from('print_jobs')
      .update({ otp_attempts: newAttempts, status: 'expired' })
      .eq('id', job.id)

    await supabase.from('audit_log').insert({
      job_id: job.id,
      kiosk_id: kioskId,
      event: 'job_expired',
      actor: 'kiosk_agent',
      metadata: { reason: result.reason, attempts: newAttempts },
    })

    return NextResponse.json({
      valid: false,
      attempts_remaining: 0,
      reason: result.reason === 'expired' ? 'expired' : 'max_attempts',
    })
  }

  // Still has attempts left
  await supabase
    .from('print_jobs')
    .update({ otp_attempts: newAttempts })
    .eq('id', job.id)

  await supabase.from('audit_log').insert({
    job_id: job.id,
    kiosk_id: kioskId,
    event: 'otp_attempt_wrong',
    actor: 'kiosk_agent',
    metadata: { attempts: newAttempts },
  })

  return NextResponse.json({
    valid: false,
    attempts_remaining: 3 - newAttempts,
    reason: 'wrong',
  })
}
