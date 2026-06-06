import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// PATCH /api/kiosk/[id]/job/[jobId]
//
// Agent calls this after attempting to print a job.
// Updates status to 'completed' or 'failed'.
//
// Request body: { status: 'completed' | 'failed', error_message?: string }
// ---------------------------------------------------------------------------

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; jobId: string }> }
) {
  const { id: kioskId, jobId } = await params
  const headerKioskId = request.headers.get('x-kiosk-id')

  if (headerKioskId && headerKioskId !== kioskId) {
    return NextResponse.json({ error: 'Kiosk ID mismatch' }, { status: 403 })
  }

  let body: { status?: string; error_message?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { status, error_message } = body

  if (!['completed', 'failed'].includes(status || '')) {
    return NextResponse.json(
      { error: 'Status must be completed or failed' },
      { status: 400 }
    )
  }

  const supabase = getAdminSupabase()

  // 1. Verify job belongs to this kiosk
  const { data: job, error: jobError } = await supabase
    .from('print_jobs')
    .select('id, status')
    .eq('id', jobId)
    .eq('kiosk_id', kioskId)
    .single()

  if (jobError || !job) {
    return NextResponse.json({ error: 'Job not found for this kiosk' }, { status: 404 })
  }

  if (job.status !== 'printing') {
    return NextResponse.json(
      { error: `Job is in "${job.status}" status, expected "printing"` },
      { status: 409 }
    )
  }

  // 2. Update job
  const updatePayload: any = {
    status,
    completed_at: status === 'completed' ? new Date().toISOString() : null,
  }

  if (status === 'failed' && error_message) {
    updatePayload.error_message = error_message
  }

  const { error: updateError } = await supabase
    .from('print_jobs')
    .update(updatePayload)
    .eq('id', jobId)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 })
  }

  // 3. Log
  await supabase.from('audit_log').insert({
    job_id: jobId,
    kiosk_id: kioskId,
    event: status === 'completed' ? 'print_completed' : 'print_failed',
    actor: 'kiosk_agent',
    metadata: error_message ? { error: error_message } : {},
  })

  return NextResponse.json({ success: true })
}
