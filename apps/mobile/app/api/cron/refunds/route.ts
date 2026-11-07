import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { createRazorpayClient } from '@vaultprint/lib'

// ---------------------------------------------------------------------------
// POST /api/cron/refunds
//
// Refunds every Razorpay payment whose job ended without a print:
//   expired (code never entered / no printer took the job) or failed.
//
// Called every minute by pg_cron (public.trigger_due_refunds, migration 008),
// only while something is due. Authenticated with the secret in
// internal_config.refund_cron_secret.
//
// Safe to call repeatedly: each job is claimed atomically (refund_status →
// 'pending'), and before refunding we ask Razorpay whether the payment was
// already refunded — a crash between "refund made" and "recorded" can't
// refund twice.
// ---------------------------------------------------------------------------

export const maxDuration = 30

const MAX_ATTEMPTS = 5
const BATCH = 10

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

type Supabase = ReturnType<typeof getAdminSupabase>

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

interface DueJob {
  id: string
  kiosk_id: string
  status: string
  razorpay_payment_id: string
  total_price: number | string
  refund_attempts: number
}

async function refundOne(supabase: Supabase, job: DueJob) {
  // Claim it — only one caller can move it to 'pending'
  const { data: claimed } = await supabase
    .from('print_jobs')
    .update({ refund_status: 'pending', refund_attempts: job.refund_attempts + 1, refund_error: null })
    .eq('id', job.id)
    .in('status', ['expired', 'failed'])
    .or(`refund_status.is.null,and(refund_status.eq.failed,refund_attempts.lt.${MAX_ATTEMPTS})`)
    .select('id')
  if (!claimed || claimed.length === 0) return { id: job.id, result: 'skipped' }

  const razorpay = createRazorpayClient()
  try {
    const payment = await razorpay.payments.fetch(job.razorpay_payment_id)

    // Already refunded (by us before a crash, or manually in the dashboard)
    if (payment.status === 'refunded' || Number(payment.amount_refunded || 0) > 0) {
      const refunds = await razorpay.payments.fetchMultipleRefund(job.razorpay_payment_id)
      const r = refunds.items?.[0]
      await supabase.from('print_jobs').update({
        refund_status: 'processed',
        refund_id: r?.id ?? null,
        refund_amount: Number(payment.amount_refunded || r?.amount || 0) / 100,
        refunded_at: r?.created_at ? new Date(r.created_at * 1000).toISOString() : new Date().toISOString(),
      }).eq('id', job.id)
      return { id: job.id, result: 'already_refunded' }
    }

    if (payment.status !== 'captured') {
      // 'authorized' (never captured) is released back by Razorpay itself;
      // anything else can't be refunded through the API
      throw new Error(`payment is "${payment.status}", not captured`)
    }

    const amount = Number(payment.amount) // paise, full refund
    const refund = await razorpay.payments.refund(job.razorpay_payment_id, {
      amount,
      speed: 'normal',
      receipt: `vp_${job.id.slice(0, 30)}`,
      notes: { job_id: job.id, reason: job.status === 'failed' ? 'print_failed' : 'not_printed' },
    })

    await supabase.from('print_jobs').update({
      refund_status: 'processed',
      refund_id: refund.id,
      refund_amount: amount / 100,
      refunded_at: new Date().toISOString(),
    }).eq('id', job.id)

    await supabase.from('audit_log').insert({
      job_id: job.id,
      kiosk_id: job.kiosk_id,
      event: 'refund_issued',
      actor: 'system',
      metadata: { refund_id: refund.id, amount_paise: amount, job_status: job.status },
    })
    return { id: job.id, result: 'refunded' }
  } catch (err) {
    const message =
      (err as { error?: { description?: string } })?.error?.description ||
      (err instanceof Error ? err.message : String(err))
    console.error('[Refunds] refund failed for job', job.id, message)
    await supabase.from('print_jobs').update({
      refund_status: 'failed',
      refund_error: message.slice(0, 500),
    }).eq('id', job.id)
    return { id: job.id, result: 'failed', error: message }
  }
}

export async function POST(request: NextRequest) {
  const supabase = getAdminSupabase()

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: secret } = await supabase
    .from('internal_config')
    .select('value')
    .eq('key', 'refund_cron_secret')
    .single()
  if (!secret?.value || !token || !safeEqual(token, secret.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: due, error } = await supabase
    .from('print_jobs')
    .select('id, kiosk_id, status, razorpay_payment_id, total_price, refund_attempts')
    .in('status', ['expired', 'failed'])
    .eq('payment_mode', 'razorpay')
    .like('razorpay_payment_id', 'pay_%') // real payments only (not hardware-test jobs)
    .or(`refund_status.is.null,and(refund_status.eq.failed,refund_attempts.lt.${MAX_ATTEMPTS})`)
    .order('updated_at', { ascending: true })
    .limit(BATCH)

  if (error) {
    console.error('[Refunds] query failed:', error)
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }

  const results = []
  for (const job of (due ?? []) as DueJob[]) results.push(await refundOne(supabase, job))
  return NextResponse.json({ processed: results.length, results })
}
