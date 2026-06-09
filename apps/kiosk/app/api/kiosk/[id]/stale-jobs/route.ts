import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// POST /api/kiosk/[id]/stale-jobs
//
// Called by the agent on startup.
// Finds jobs stuck in 'printing' state for longer than stale_before timestamp
// (typically now - 10 minutes), and resets them back to 'queued' so they can
// be retried on the next poll cycle.
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
  const { data: staleJobs, error: findError } = await (supabase as any)
    .from('print_jobs')
    .select('id')
    .eq('kiosk_id', kioskId)
    .eq('status', 'printing')
    .lt('updated_at', stale_before)

  if (findError) {
    return NextResponse.json({ error: 'Failed to query stale jobs' }, { status: 500 })
  }

  if (!staleJobs || staleJobs.length === 0) {
    return NextResponse.json({ recovered: 0 })
  }

  const staleIds = staleJobs.map((j: any) => j.id)

  // Reset them all back to 'queued'
  const { error: updateError } = await (supabase as any)
    .from('print_jobs')
    .update({ status: 'queued', error_message: null })
    .in('id', staleIds)

  if (updateError) {
    return NextResponse.json({ error: 'Failed to reset stale jobs' }, { status: 500 })
  }

  // Write audit log entries
  const auditRows = staleIds.map((id: string) => ({
    job_id: id,
    kiosk_id: kioskId,
    event: 'stale_job_recovered',
    actor: 'kiosk_agent',
    metadata: { stale_before },
  }))

  await (supabase as any).from('audit_log').insert(auditRows)

  return NextResponse.json({ recovered: staleIds.length })
}
