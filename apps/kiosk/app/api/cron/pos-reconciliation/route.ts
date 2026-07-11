import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  sendPosReconciliationEmail,
  type PosReconciliationKiosk,
  type PosDiscrepancyEvent,
} from '@vaultprint/lib'

// ---------------------------------------------------------------------------
// GET /api/cron/pos-reconciliation — daily POS reconciliation (PRD D4)
//
// Scheduled by Vercel Cron at 18:00 UTC (23:30 IST) — see vercel.json.
// Auth: Authorization: Bearer ${CRON_SECRET} (Vercel Cron convention).
//
// Per kiosk: sum + count + receipt refs of today's completed POS jobs,
// plus any pos_amount_discrepancy audit events, emailed to the admin.
// The admin compares against each POS terminal's settlement report —
// manual-confirm fraud is detected within 24h even when not prevented.
// ---------------------------------------------------------------------------

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getAdminSupabase()

  // "Today" in IST (the fleet operates in IST)
  const now = new Date()
  const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000)
  const reportDate = istNow.toISOString().slice(0, 10)
  const startOfDayIst = new Date(`${reportDate}T00:00:00.000+05:30`).toISOString()

  // Completed POS jobs today, per kiosk
  const { data: jobs, error: jobsError } = await supabase
    .from('print_jobs')
    .select('id, kiosk_id, total_price, pos_transaction_ref, pos_client_amount, created_at, kiosks(name)')
    .eq('payment_mode', 'pos')
    .eq('status', 'completed')
    .gte('created_at', startOfDayIst)

  if (jobsError) {
    return NextResponse.json(
      { error: 'Failed to query POS jobs', details: jobsError.message },
      { status: 500 }
    )
  }

  const byKiosk = new Map<string, PosReconciliationKiosk>()
  const discrepancies: PosDiscrepancyEvent[] = []

  for (const job of jobs ?? []) {
    const kioskName =
      (job as unknown as { kiosks?: { name?: string } }).kiosks?.name ?? job.kiosk_id
    const fallback: PosReconciliationKiosk = {
      kiosk_name: kioskName,
      job_count: 0,
      total_amount: 0,
      receipt_refs: [],
    }
    const entry = byKiosk.get(job.kiosk_id) ?? fallback
    entry.job_count += 1
    entry.total_amount += Number(job.total_price) || 0
    if (job.pos_transaction_ref) entry.receipt_refs.push(job.pos_transaction_ref)
    byKiosk.set(job.kiosk_id, entry)

    if (
      job.pos_client_amount != null &&
      job.total_price != null &&
      Number(job.pos_client_amount) !== Number(job.total_price)
    ) {
      discrepancies.push({
        job_id: job.id,
        kiosk_name: kioskName,
        total_price: Number(job.total_price),
        client_amount: Number(job.pos_client_amount),
        created_at: job.created_at,
      })
    }
  }

  const report = Array.from(byKiosk.values())
  const { sent } = await sendPosReconciliationEmail(reportDate, report, discrepancies)

  await supabase.from('audit_log').insert({
    event: 'pos_reconciliation_sent',
    actor: 'cron',
    metadata: {
      report_date: reportDate,
      kiosk_count: report.length,
      job_count: report.reduce((s, k) => s + k.job_count, 0),
      total_amount: report.reduce((s, k) => s + k.total_amount, 0),
      discrepancy_count: discrepancies.length,
      email_sent: sent,
    },
  })

  return NextResponse.json({
    report_date: reportDate,
    kiosks: report,
    discrepancies,
    email_sent: sent,
  })
}
