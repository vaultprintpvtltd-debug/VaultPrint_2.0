'use client'

// ---------------------------------------------------------------------------
// kiosk-api — authenticated calls from the kiosk SCREEN to /api/kiosk/*.
//
// The kiosk API routes are guarded by the per-kiosk API key (middleware
// Bearer auth). The Print Agent keeps that key in agent/.env; the kiosk
// browser keeps the same key in localStorage on the same trusted machine.
//
// Provisioning (one-time, during kiosk setup):
//   open /kiosk/[kioskId]/mode2?key=<KIOSK_API_KEY> once — the key is
//   stored in localStorage and stripped from the URL.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'vaultprint_kiosk_api_key'

export function getKioskApiKey(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(STORAGE_KEY)
}

/** Store the key if present in the URL (?key=...), then strip it. */
export function provisionKioskApiKeyFromUrl(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  const key = url.searchParams.get('key')
  if (key) {
    window.localStorage.setItem(STORAGE_KEY, key)
    url.searchParams.delete('key')
    window.history.replaceState({}, '', url.toString())
  }
}

export async function kioskApi<T = Record<string, unknown>>(
  kioskId: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const apiKey = getKioskApiKey()
  const res = await fetch(`/api/kiosk/${kioskId}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey ?? ''}`,
    },
    body: JSON.stringify(body ?? {}),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  return { ok: res.ok, status: res.status, data }
}
