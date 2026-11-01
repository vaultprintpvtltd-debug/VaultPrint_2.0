import type { Viewport } from 'next'

// ---------------------------------------------------------------------------
// Kiosk screens only (not /admin): the public touchscreen must never zoom —
// a stray pinch or double-tap would push the code pad off the screen.
// ---------------------------------------------------------------------------

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#09090b',
}

export default function KioskGroupLayout({ children }: { children: React.ReactNode }) {
  // touch-action: manipulation disables double-tap-to-zoom
  return <div style={{ touchAction: 'manipulation' }}>{children}</div>
}
