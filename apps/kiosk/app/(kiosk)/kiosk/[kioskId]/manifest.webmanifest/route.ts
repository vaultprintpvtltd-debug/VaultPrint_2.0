import { NextResponse } from 'next/server'

// ---------------------------------------------------------------------------
// GET /kiosk/[kioskId]/manifest.webmanifest
//
// Per-kiosk web app manifest. Installing the kiosk screen as a full-screen
// app removes Chrome's address bar entirely (Android box kiosk mode: the
// installed app is then pinned with lock-task mode — agent/android/kiosk.sh).
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kioskId: string }> }
) {
  const { kioskId } = await params
  if (!UUID_RE.test(kioskId)) {
    return NextResponse.json({ error: 'Invalid kiosk id' }, { status: 404 })
  }

  const base = `/kiosk/${kioskId}`
  return NextResponse.json(
    {
      id: base,
      name: 'VaultPrint Kiosk',
      short_name: 'VaultPrint',
      start_url: base,
      scope: base,
      display: 'fullscreen',
      orientation: 'landscape',
      background_color: '#09090b',
      theme_color: '#09090b',
      icons: [
        { src: '/kiosk-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/kiosk-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      ],
    },
    { headers: { 'Content-Type': 'application/manifest+json' } }
  )
}
