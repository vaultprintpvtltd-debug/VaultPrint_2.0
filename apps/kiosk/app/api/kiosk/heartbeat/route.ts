import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// POST /api/kiosk/heartbeat
//
// Called by the print agent every 30 seconds to signal the kiosk is alive.
// Middleware has already validated the API key and set x-kiosk-id header.
//
// Updates: kiosks.last_heartbeat, kiosks.os_platform, kiosks.status → 'idle'
//          (only if currently 'offline')
//
// Request body: { os_platform: string, printer_name?: string }
// Response:     { ok: true, kiosk_id: string }
// ---------------------------------------------------------------------------

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

export async function POST(request: NextRequest) {
  // x-kiosk-id is set by middleware after API key validation
  const kioskId = request.headers.get('x-kiosk-id')

  if (!kioskId) {
    return NextResponse.json(
      { error: 'Kiosk ID not resolved. Middleware may not have run.' },
      { status: 401 }
    )
  }

  // Parse optional body
  let body: { os_platform?: string; printer_name?: string } = {}
  try {
    body = await request.json()
  } catch {
    // Body is optional for heartbeat
  }

  const supabase = getAdminSupabase()

  // Build update payload
  const updatePayload: Record<string, unknown> = {
    last_heartbeat: new Date().toISOString(),
  }

  if (body.os_platform) {
    updatePayload.os_platform = body.os_platform
  }

  if (body.printer_name) {
    updatePayload.printer_name = body.printer_name
  }

  // Fetch current status to decide if we should bring it online
  const { data: kiosk } = await supabase
    .from('kiosks')
    .select('status')
    .eq('id', kioskId)
    .single()

  if (kiosk && kiosk.status === 'offline') {
    updatePayload.status = 'idle'
  }

  // Update kiosk row
  const { error: updateError } = await supabase
    .from('kiosks')
    .update(updatePayload)
    .eq('id', kioskId)

  if (updateError) {
    console.error('Heartbeat update failed:', updateError)
    return NextResponse.json(
      { error: 'Failed to update heartbeat', details: updateError.message },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true, kiosk_id: kioskId })
}
