import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// GET /api/kiosk/[id]/queue
//
// Agent polls this every 3s. Returns the oldest job where status='queued'.
// Automatically transitions the job to 'printing'.
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

  // 1. Find oldest queued job for this kiosk
  const { data: jobs, error: findError } = await supabase
    .from('print_jobs')
    .select('id, file_path, color_mode, duplex, copies, pages_to_print, orientation, paper_size')
    .eq('kiosk_id', kioskId)
    .eq('status', 'queued')
    .order('updated_at', { ascending: true })
    .limit(1)

  if (findError) {
    return NextResponse.json({ error: 'Failed to query queue' }, { status: 500 })
  }

  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ job: null })
  }

  const job = jobs[0]

  // 2. Transition to 'printing'
  const { error: updateError } = await supabase
    .from('print_jobs')
    .update({ status: 'printing' })
    .eq('id', job.id)
    // Concurrency check: only update if still queued
    .eq('status', 'queued')

  if (updateError) {
    return NextResponse.json({ error: 'Failed to claim job' }, { status: 500 })
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
