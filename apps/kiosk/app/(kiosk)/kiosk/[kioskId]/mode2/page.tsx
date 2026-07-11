'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import { useKioskConfig } from '@/hooks/use-kiosk-config'
import { useMode2Realtime } from '@/hooks/use-mode2-realtime'
import { getSchoolOfflineMode } from '@vaultprint/lib/kiosk-config'
import {
  kioskApi,
  getKioskApiKey,
  provisionKioskApiKeyFromUrl,
} from '@/lib/kiosk-api'

// ---------------------------------------------------------------------------
// /kiosk/[kioskId]/mode2 — Mode 2 entry screen (PRD C2.4)
//
// Requests a single-use upload token, shows the hotspot SSID/password and
// the token-bearing QR (http://{gateway_ip}:{port}/upload?t=...).
// Navigates to /mode2/customize when the job row lands (Supabase Realtime).
// ---------------------------------------------------------------------------

const TOKEN_TTL_SECONDS = 5 * 60

export default function Mode2HotspotPage() {
  const params = useParams<{ kioskId: string }>()
  const router = useRouter()
  const kioskId = params.kioskId

  const { config } = useKioskConfig(kioskId)
  const school = config ? getSchoolOfflineMode(config) : undefined

  const [uploadUrl, setUploadUrl] = useState<string | null>(null)
  const [timeLeft, setTimeLeft] = useState(TOKEN_TTL_SECONDS)
  const [error, setError] = useState<string | null>(null)
  const [provisioned, setProvisioned] = useState(true)

  // ── One-time API key provisioning via ?key= ────────────────────────────
  useEffect(() => {
    provisionKioskApiKeyFromUrl()
    // localStorage is only readable after mount; defer the setState so the
    // effect body stays free of synchronous state updates.
    const ok = Boolean(getKioskApiKey())
    queueMicrotask(() => setProvisioned(ok))
  }, [])

  // ── Request a fresh upload token ───────────────────────────────────────
  const requestToken = useCallback(async () => {
    const { ok, data } = await kioskApi<{ upload_url: string }>(
      kioskId,
      '/mode2/upload-token'
    )
    if (!ok) {
      setError(data.error || 'Could not start an upload session.')
      return
    }
    setError(null)
    setUploadUrl(data.upload_url)
    setTimeLeft(TOKEN_TTL_SECONDS)
  }, [kioskId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async token fetch; all setState calls run after await, not synchronously
    if (provisioned) void requestToken()
  }, [provisioned, requestToken])

  // ── Token countdown; auto-refresh at expiry ────────────────────────────
  useEffect(() => {
    if (!uploadUrl) return
    const t = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          requestToken()
          return TOKEN_TTL_SECONDS
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [uploadUrl, requestToken])

  // ── Realtime: job row inserted → customize ─────────────────────────────
  useMode2Realtime(kioskId, (job) => {
    if (job.status === 'created') {
      router.push(`/kiosk/${kioskId}/mode2/customize?jobId=${job.id}`)
    }
  })

  // ── Cancel — release the token, back to idle ───────────────────────────
  async function handleCancel() {
    await kioskApi(kioskId, '/mode2/cancel')
    router.push(`/kiosk/${kioskId}`)
  }

  // ── Config missing / mode disabled → back to idle ──────────────────────
  useEffect(() => {
    if (config && !school) router.push(`/kiosk/${kioskId}`)
  }, [config, school, router, kioskId])

  if (!config || !school) return null

  return (
    <div className="flex w-full flex-col items-center gap-5">
      <div className="text-center">
        <h2 className="text-xl lg:text-2xl font-bold text-white tracking-wide">
          {school.client.name} — Student Upload
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          1. Join the WiFi below &nbsp;·&nbsp; 2. Scan the QR &nbsp;·&nbsp; 3. Choose your PDF
        </p>
      </div>

      {/* Hotspot credentials */}
      <div className="flex w-full max-w-[400px] items-center justify-between rounded-2xl border border-white/10 bg-black/30 px-6 py-4 shadow-inner backdrop-blur-md">
        <div className="text-left">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">WiFi network</p>
          <p className="font-jakarta text-lg font-bold text-teal-400">{school.hotspot.ssid}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Password</p>
          <p className="font-jakarta text-lg font-bold text-white">{school.hotspot.password}</p>
        </div>
      </div>

      {/* Token QR */}
      {!provisioned ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-center text-sm text-amber-300 max-w-[400px]">
          This kiosk screen is not provisioned. Open this page once with
          <code className="mx-1 rounded bg-black/40 px-1.5">?key=&lt;KIOSK_API_KEY&gt;</code>
          during setup.
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-center max-w-[400px]">
          <p className="text-sm text-red-300">{error}</p>
          <button
            onClick={requestToken}
            className="mt-3 rounded-full bg-white/10 px-5 py-2 text-sm text-white transition hover:bg-white/20"
          >
            Try again
          </button>
        </div>
      ) : uploadUrl ? (
        <>
          <div className="rounded-3xl border border-white/10 bg-[#3a4354]/90 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
            <div className="rounded-xl bg-white p-3 flex items-center justify-center">
              <QRCodeSVG value={uploadUrl} size={220} level="M" bgColor="#ffffff" fgColor="#000000" />
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/5 bg-black/30 px-5 py-2 text-sm text-zinc-300 shadow-inner backdrop-blur-md">
            <div className="h-2 w-2 rounded-full bg-teal-400 animate-pulse shadow-[0_0_8px_rgba(45,212,191,0.8)]" />
            <span>
              Session expires in{' '}
              <strong className="font-jakarta font-bold text-teal-400">
                {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
              </strong>
            </span>
          </div>
        </>
      ) : (
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-zinc-700 border-t-teal-400" />
      )}

      <button
        onClick={handleCancel}
        className="mt-1 rounded-full border border-white/10 bg-white/5 px-6 py-2.5 text-sm text-zinc-300 transition hover:bg-white/10 hover:text-white"
      >
        Cancel — back to start
      </button>
    </div>
  )
}
