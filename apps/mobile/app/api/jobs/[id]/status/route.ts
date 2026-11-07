import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getPrinterCapabilities, parseKioskConfig } from '@vaultprint/lib/kiosk-config'

// ---------------------------------------------------------------------------
// GET /api/jobs/[id]/status
//
// Polls the current status of a print job. Used by the OTP page to detect
// when the job transitions to 'completed' or 'failed'.
//
// Response: { status, error_message?, completed_at?, ..., capabilities }
// ---------------------------------------------------------------------------

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params
  const supabase = getAdminSupabase()

  const { data: job, error } = await supabase
    .from('print_jobs')
    .select('*, kiosks(config)') // one round trip for job + kiosk config
    .eq('session_id', sessionId)
    .single()

  if (error || !job) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const kiosk = job.kiosks as { config?: unknown } | null
  const realPayment = typeof job.razorpay_payment_id === 'string' && job.razorpay_payment_id.startsWith('pay_')

  return NextResponse.json({
    status: job.status,
    error_message: job.error_message,
    completed_at: job.completed_at,
    file_name: job.file_name,
    total_pages: job.total_pages,
    copies: job.copies,
    color_mode: job.color_mode,
    duplex: job.duplex,
    orientation: job.orientation,
    quality: job.quality,
    paper_size: job.paper_size,
    price_per_page: job.price_per_page,
    billable_pages: job.billable_pages,
    total_price: job.total_price,
    // Refund state for jobs that ended without a print (migration 008)
    refund_status: job.refund_status ?? (realPayment ? null : 'not_applicable'),
    refund_amount: job.refund_amount ?? null,
    is_collated: job.is_collated,
    pages_per_sheet: job.pages_per_sheet,
    page_order: job.page_order,
    border: job.border,
    fit_scale: job.fit_scale,
    settings: {
        copies: job.copies,
        color_mode: job.color_mode,
        duplex: job.duplex,
        orientation: job.orientation,
        paper_size: job.paper_size,
    },
    capabilities: getPrinterCapabilities(parseKioskConfig(kiosk?.config)),
  })
}
