import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyOTP } from '@vaultprint/lib'

// ---------------------------------------------------------------------------
// POST /api/kiosk/[id]/otp — the print release gate
//
// Kiosk submits the OTP the customer typed. A correct OTP atomically moves
// the job 'paid' → 'queued'; only then can the print agent claim it. Until
// this point a paid document is never printed.
//
// Request:  { otp: string, session_id?: string }
//   session_id given → checked against that job only (3 attempts per job)
//   session_id absent → matched against this kiosk's live 'paid' jobs (the
//                       kiosk screen does not know who is standing there);
//                       wrong guesses are rate-limited per kiosk
// Response: { valid: true, job_id, total_pages, copies, color_mode, duplex }
//         | { valid: false, attempts_remaining, reason }
//
// The release is refused (503, OTP not consumed) while the print agent is
// offline, so a customer's code is never spent on a dead printer.
// ---------------------------------------------------------------------------

const KIOSK_WRONG_ATTEMPT_LIMIT = 10
const KIOSK_WRONG_ATTEMPT_WINDOW_MS = 10 * 60 * 1000
const AGENT_ONLINE_WINDOW_MS = 2 * 60 * 1000
const MAX_CANDIDATES = 10

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

type Supabase = ReturnType<typeof getAdminSupabase>

interface CandidateJob {
  id: string
  otp_hash: string | null
  otp_expires_at: string | null
  otp_attempts: number
  status: string
}

async function audit(
  supabase: Supabase,
  kioskId: string,
  jobId: string | null,
  event: string,
  metadata: Record<string, unknown> = {}
) {
  await supabase.from('audit_log').insert({
    job_id: jobId,
    kiosk_id: kioskId,
    event,
    actor: 'kiosk_agent',
    metadata,
  })
}

/** Atomic 'paid' → 'queued'. Returns the released job, or null if it raced. */
async function releaseJob(supabase: Supabase, kioskId: string, jobId: string) {
  const { data } = await supabase
    .from('print_jobs')
    .update({ status: 'queued' })
    .eq('id', jobId)
    .eq('kiosk_id', kioskId)
    .eq('status', 'paid')
    .select('id, total_pages, copies, color_mode, duplex')

  return data && data.length > 0 ? data[0] : null
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

  if (!otp || !/^\d{6}$/.test(otp)) {
    return NextResponse.json(
      { error: 'OTP must be exactly 6 digits' },
      { status: 400 }
    )
  }

  const supabase = getAdminSupabase()

  // ── Kiosk-level brute-force limit ─────────────────────────────────────
  const windowStart = new Date(Date.now() - KIOSK_WRONG_ATTEMPT_WINDOW_MS).toISOString()
  const { count: recentWrong } = await supabase
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('kiosk_id', kioskId)
    .eq('event', 'otp_attempt_wrong')
    .gte('created_at', windowStart)

  const wrongSoFar = recentWrong ?? 0
  if (wrongSoFar >= KIOSK_WRONG_ATTEMPT_LIMIT) {
    return NextResponse.json(
      { valid: false, attempts_remaining: 0, reason: 'locked' },
      { status: 429 }
    )
  }

  // ── Printer must be online before a job is released ───────────────────
  const { data: kiosk } = await supabase
    .from('kiosks')
    .select('last_heartbeat')
    .eq('id', kioskId)
    .single()

  const lastBeat = kiosk?.last_heartbeat ? new Date(kiosk.last_heartbeat).getTime() : 0
  if (Date.now() - lastBeat > AGENT_ONLINE_WINDOW_MS) {
    return NextResponse.json(
      { valid: false, attempts_remaining: KIOSK_WRONG_ATTEMPT_LIMIT - wrongSoFar, reason: 'printer_offline' },
      { status: 503 }
    )
  }

  // ── Find the candidate job(s) ─────────────────────────────────────────
  let candidates: CandidateJob[]

  if (session_id) {
    const { data: job, error: jobError } = await supabase
      .from('print_jobs')
      .select('id, otp_hash, otp_expires_at, otp_attempts, status')
      .eq('session_id', session_id)
      .eq('kiosk_id', kioskId)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found for this kiosk' }, { status: 404 })
    }

    if (job.status !== 'paid') {
      return NextResponse.json(
        { error: `Job is in "${job.status}" status, cannot verify OTP` },
        { status: 409 }
      )
    }

    candidates = [job]
  } else {
    const { data } = await supabase
      .from('print_jobs')
      .select('id, otp_hash, otp_expires_at, otp_attempts, status')
      .eq('kiosk_id', kioskId)
      .eq('payment_mode', 'razorpay')
      .eq('status', 'paid')
      .not('otp_hash', 'is', null)
      .gt('otp_expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(MAX_CANDIDATES)

    candidates = data ?? []
  }

  // ── Verify ────────────────────────────────────────────────────────────
  let lastReason: string | null = 'wrong'
  for (const job of candidates) {
    if (!job.otp_hash || !job.otp_expires_at) continue
    const result = await verifyOTP(otp, job.otp_hash, job.otp_expires_at, job.otp_attempts)
    lastReason = result.reason

    if (result.valid) {
      const released = await releaseJob(supabase, kioskId, job.id)
      if (!released) {
        return NextResponse.json(
          { error: 'This code has already been used or has expired' },
          { status: 409 }
        )
      }

      await audit(supabase, kioskId, job.id, 'otp_verified')

      return NextResponse.json({
        valid: true,
        job_id: released.id,
        total_pages: released.total_pages,
        copies: released.copies,
        color_mode: released.color_mode,
        duplex: released.duplex,
      })
    }
  }

  // ── Wrong code ────────────────────────────────────────────────────────
  const remaining = KIOSK_WRONG_ATTEMPT_LIMIT - wrongSoFar - 1

  if (session_id && candidates.length === 1) {
    // Single-job path keeps the original per-job 3-attempt expiry
    const job = candidates[0]
    const newAttempts = job.otp_attempts + 1

    if (newAttempts >= 3 || lastReason === 'expired' || lastReason === 'max_attempts') {
      await supabase
        .from('print_jobs')
        .update({ otp_attempts: newAttempts, status: 'expired' })
        .eq('id', job.id)
        .eq('status', 'paid')

      await audit(supabase, kioskId, job.id, 'job_expired', {
        reason: lastReason,
        attempts: newAttempts,
        refund_due: true,
      })

      return NextResponse.json({
        valid: false,
        attempts_remaining: 0,
        reason: lastReason === 'expired' ? 'expired' : 'max_attempts',
      })
    }

    await supabase
      .from('print_jobs')
      .update({ otp_attempts: newAttempts })
      .eq('id', job.id)

    await audit(supabase, kioskId, job.id, 'otp_attempt_wrong', { attempts: newAttempts })

    return NextResponse.json({
      valid: false,
      attempts_remaining: Math.min(3 - newAttempts, remaining),
      reason: 'wrong',
    })
  }

  await audit(supabase, kioskId, null, 'otp_attempt_wrong', { candidates: candidates.length })

  return NextResponse.json({
    valid: false,
    attempts_remaining: Math.max(0, remaining),
    reason: 'wrong',
  })
}
