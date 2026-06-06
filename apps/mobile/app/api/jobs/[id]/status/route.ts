import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// GET /api/jobs/[id]/status
//
// Polls the current status of a print job. Used by the OTP page to detect
// when the job transitions to 'completed' or 'failed'.
//
// Response: { status, error_message?, completed_at? }
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
    .select('status, error_message, completed_at')
    .eq('session_id', sessionId)
    .single()

  if (error || !job) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  return NextResponse.json({
    status: job.status,
    error_message: job.error_message,
    completed_at: job.completed_at,
  })
}
