import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { parseKioskConfig, getSchoolOfflineMode } from '@vaultprint/lib/kiosk-config'

// ---------------------------------------------------------------------------
// POST /api/kiosk/[id]/mode2/upload-token
//
// Issues the single-use Mode 2 upload token — the session boundary (PRD C2.2).
// Middleware has already validated the kiosk API key (x-kiosk-id header).
//
// - Deletes any unused token for this kiosk (one live token per kiosk,
//   also enforced by a partial unique index)
// - Inserts 32 crypto-random URL-safe bytes with a 5-minute expiry
// - Audits mode2_token_issued
//
// Response: { token, expires_at, upload_url }
// ---------------------------------------------------------------------------

const TOKEN_TTL_MS = 5 * 60 * 1000 // 5 minutes

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

  const supabase = getAdminSupabase()

  // Mode 2 must be enabled in this kiosk's config
  const { data: kiosk, error: kioskError } = await supabase
    .from('kiosks')
    .select('id, config')
    .eq('id', kioskId)
    .single()

  if (kioskError || !kiosk) {
    return NextResponse.json({ error: 'Kiosk not found' }, { status: 404 })
  }

  const schoolMode = getSchoolOfflineMode(parseKioskConfig(kiosk.config))
  if (!schoolMode) {
    await supabase.from('audit_log').insert({
      kiosk_id: kioskId,
      event: 'mode2_token_rejected',
      actor: 'kiosk_agent',
      metadata: { reason: 'school_offline_not_enabled' },
    })
    return NextResponse.json(
      { error: 'Mode 2 is not enabled for this kiosk' },
      { status: 403 }
    )
  }

  // One live token per kiosk: remove any unused token before inserting
  await supabase
    .from('mode2_upload_tokens')
    .delete()
    .eq('kiosk_id', kioskId)
    .is('used_at', null)

  const token = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString()

  const { error: insertError } = await supabase
    .from('mode2_upload_tokens')
    .insert({ token, kiosk_id: kioskId, expires_at: expiresAt })

  if (insertError) {
    return NextResponse.json(
      { error: 'Failed to issue upload token', details: insertError.message },
      { status: 500 }
    )
  }

  await supabase.from('audit_log').insert({
    kiosk_id: kioskId,
    event: 'mode2_token_issued',
    actor: 'kiosk_agent',
    metadata: { expires_at: expiresAt },
  })

  // The URL the iPad's QR encodes: local hotspot, plain HTTP by design
  const uploadUrl = `http://${schoolMode.hotspot.gateway_ip}:${schoolMode.hotspot.receiver_port}/upload?t=${token}`

  return NextResponse.json({
    token,
    expires_at: expiresAt,
    upload_url: uploadUrl,
  })
}
