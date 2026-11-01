import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// POST /api/kiosk/[id]/stale-jobs
//
// Called by the agent on startup.
// Finds jobs stuck in 'printing' state for longer than stale_before timestamp
// (typically now - 10 minutes) and marks them 'failed' for operator review.
//
// They are deliberately NOT requeued: the agent may have crashed after the
// printer already received the pages, and a blind retry double-prints.
// Response: { recovered: 0, interrupted: n } (recovered kept for old agents)
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

  let body: { stale_before?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { stale_before } = body

  if (!stale_before) {
    return NextResponse.json({ error: 'stale_before is required' }, { status: 400 })
  }

  const supabase = getAdminSupabase()

  // Find all jobs stuck in 'printing' for this kiosk older than stale_before
  const { data: staleJobs, error: findError } = await supabase
    .from('print_jobs')
    .select('id')
    .eq('kiosk_id', kioskId)
    .eq('status', 'printing')
    .lt('updated_at', stale_before)

  if (findError) {
    return NextResponse.json({ error: 'Failed to query stale jobs' }, { status: 500 })
  }

  if (!staleJobs || staleJobs.length === 0) {
    return NextResponse.json({ recovered: 0, interrupted: 0 })
  }

  const staleIds = (staleJobs as { id: string }[]).map((j) => j.id)

  // Fail them for review — never auto-reprint
  const { error: updateError } = await supabase
    .from('print_jobs')
    .update({
      status: 'failed',
      error_message: 'Interrupted while printing (agent restart) — not retried automatically to avoid a duplicate print',
    })
    .in('id', staleIds)
    .eq('status', 'printing')

  if (updateError) {
    return NextResponse.json({ error: 'Failed to mark stale jobs' }, { status: 500 })
  }

  // Write audit log entries
  const auditRows = staleIds.map((id: string) => ({
    job_id: id,
    kiosk_id: kioskId,
    event: 'print_interrupted',
    actor: 'kiosk_agent',
    metadata: { stale_before, review_required: true },
  }))

  await supabase.from('audit_log').insert(auditRows)

  return NextResponse.json({ recovered: 0, interrupted: staleIds.length })
}
