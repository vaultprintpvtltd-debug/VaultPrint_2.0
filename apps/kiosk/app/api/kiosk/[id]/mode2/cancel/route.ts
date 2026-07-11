import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// POST /api/kiosk/[id]/mode2/cancel
//
// Cancel button on every Mode 2 screen (PRD C2.3). Expires the current
// POS session immediately instead of waiting for the pg_cron timeout:
//   - marks the job 'expired' (only pre-payment POS jobs on THIS kiosk)
//   - deletes its Storage object
//   - deletes any unused upload token for the kiosk
//
// Request: { job_id?: string }  — token-only cancels send no job_id
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

  let body: { job_id?: string } = {}
  try {
    body = await request.json()
  } catch {
    // job_id is optional — token-only cancel
  }

  const supabase = getAdminSupabase()

  // Always release the kiosk's live upload token
  await supabase
    .from('mode2_upload_tokens')
    .delete()
    .eq('kiosk_id', kioskId)
    .is('used_at', null)

  if (body.job_id) {
    // Expire only if it's THIS kiosk's POS job and still pre-print
    const { data: expired } = await supabase
      .from('print_jobs')
      .update({ status: 'expired' })
      .eq('id', body.job_id)
      .eq('kiosk_id', kioskId)
      .eq('payment_mode', 'pos')
      .in('status', ['created', 'uploaded', 'customized', 'payment_pending'])
      .select('id, file_path')

    if (expired && expired.length > 0) {
      const job = expired[0]
      if (job.file_path) {
        await supabase.storage.from('print-files').remove([job.file_path])
      }
      await supabase.from('audit_log').insert({
        job_id: job.id,
        kiosk_id: kioskId,
        event: 'mode2_session_expired',
        actor: 'kiosk_agent',
        metadata: { reason: 'cancelled_at_kiosk' },
      })
    }
  }

  return NextResponse.json({ success: true })
}
