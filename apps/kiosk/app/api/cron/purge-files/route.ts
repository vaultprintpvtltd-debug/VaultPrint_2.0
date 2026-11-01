import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { purgeJobFiles } from '@/lib/purge-files'

// ---------------------------------------------------------------------------
// GET /api/cron/purge-files — daily customer-file sweep
//
// Scheduled by Vercel Cron (see vercel.json). Auth: Bearer ${CRON_SECRET}.
// Online kiosks are also swept on every heartbeat; this catches files for
// kiosks that are offline. Rules live in lib/purge-files.ts.
// ---------------------------------------------------------------------------

const BATCH = 200
const MAX_BATCHES = 10

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

  let purged = 0
  for (let i = 0; i < MAX_BATCHES; i++) {
    const n = await purgeJobFiles(supabase, { limit: BATCH })
    purged += n
    if (n < BATCH) break
  }

  return NextResponse.json({ ok: true, purged })
}
