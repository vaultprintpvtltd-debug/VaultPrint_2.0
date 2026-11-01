import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// GET /api/kiosk/[id]/queue
//
// Agent polls this every 3s. Claims the oldest job where status='queued'
// (released by a correct OTP at the kiosk, or a confirmed POS payment) and
// transitions it to 'printing' atomically via claim_next_job().
// Also generates a signed URL for the agent to download the PDF.
//
// Response: { job: { id, file_url, settings, copies, total_pages } } or { job: null }
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
  const { id: kioskId } = await params
  const headerKioskId = request.headers.get('x-kiosk-id')

  if (headerKioskId && headerKioskId !== kioskId) {
    return NextResponse.json({ error: 'Kiosk ID mismatch' }, { status: 403 })
  }

  const supabase = getAdminSupabase()

  // 1. Atomically claim the oldest released job (claim_next_job uses
  //    FOR UPDATE SKIP LOCKED and flips it to 'printing' in one statement,
  //    so overlapping polls can never receive the same job twice).
  const { data: claimed, error: claimError } = await supabase
    .rpc('claim_next_job', { p_kiosk_id: kioskId })

  if (claimError) {
    return NextResponse.json({ error: 'Failed to claim job' }, { status: 500 })
  }

  const job = (claimed as Array<Record<string, unknown>> | null)?.[0] as
    | {
        id: string
        file_path: string
        color_mode: string
        duplex: boolean
        copies: number
        pages_to_print: string
        orientation: string
        paper_size: string
        payment_mode: string
        razorpay_payment_id: string | null
      }
    | undefined

  if (!job) {
    return NextResponse.json({ job: null })
  }

  // 2. Defence in depth: never print an online-payment job with no payment
  if (job.payment_mode === 'razorpay' && !job.razorpay_payment_id) {
    await supabase
      .from('print_jobs')
      .update({ status: 'failed', error_message: 'No payment recorded — refused to print' })
      .eq('id', job.id)

    await supabase.from('audit_log').insert({
      job_id: job.id,
      kiosk_id: kioskId,
      event: 'print_refused_unpaid',
      actor: 'kiosk_agent',
      metadata: {},
    })

    return NextResponse.json({ job: null })
  }

  // 3. Generate signed URL (valid for 10 minutes)
  const { data: signedData, error: signError } = await supabase.storage
    .from('print-files')
    .createSignedUrl(job.file_path, 600)

  if (signError || !signedData) {
    // If we fail to get the file, we should probably revert the status or mark as failed
    await supabase
      .from('print_jobs')
      .update({ status: 'failed', error_message: 'Failed to generate download URL' })
      .eq('id', job.id)

    return NextResponse.json({ error: 'Failed to generate download URL' }, { status: 500 })
  }

  // 4. Log
  await supabase.from('audit_log').insert({
    job_id: job.id,
    kiosk_id: kioskId,
    event: 'print_started',
    actor: 'kiosk_agent',
    metadata: {},
  })

  // Return job payload to agent
  return NextResponse.json({
    job: {
      id: job.id,
      file_url: signedData.signedUrl,
      copies: job.copies,
      color_mode: job.color_mode,
      duplex: job.duplex,
      orientation: job.orientation,
      pages_to_print: job.pages_to_print,
      paper_size: job.paper_size,
    }
  })
}
