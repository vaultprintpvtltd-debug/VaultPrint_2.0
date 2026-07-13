'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import { useKioskRealtime } from '@/hooks/use-kiosk-realtime'
import { useKioskConfig } from '@/hooks/use-kiosk-config'
import { getEnabledModes, type KioskMode } from '@vaultprint/lib/kiosk-config'

const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN || 'https://vaultprint-mobile.vercel.app'

export default function KioskQRPage() {
  const params = useParams<{ kioskId: string }>()
  const router = useRouter()
  const kioskId = params.kioskId

  // Cache-buster for the QR: a pure counter (not Date.now(), which is impure
  // during render). Incremented once per 5-minute refresh cycle.
  const [refreshTick, setRefreshTick] = useState(0)
  const [timeLeft, setTimeLeft] = useState(300)

  // ── Kiosk Configuration Layer (PRD C1) ─────────────────────────────────
  // Fail-safe: a corrupt/missing config degrades to standard-only, so the
  // selector never appears on standard kiosks and this page renders exactly
  // what it rendered before the config layer existed.
  const { config } = useKioskConfig(kioskId)
  const enabledModes = config ? getEnabledModes(config) : null
  const [selectedMode, setSelectedMode] = useState<'standard' | null>(null)

  // ── Realtime subscription ──────────────────────────────────────────────
  useKioskRealtime(kioskId)

  // ── QR regeneration (every 5 minutes with live countdown) ──────────────
  useEffect(() => {
    const qrInterval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          setRefreshTick((n) => n + 1)
          return 300
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(qrInterval)
  }, [])

  const qrUrl = `${APP_DOMAIN}/start?k=${kioskId}&t=${refreshTick}`

  // ── Mode selector (only ever rendered when 2+ modes are enabled) ───────
  const showSelector =
    enabledModes !== null && enabledModes.length >= 2 && selectedMode === null

  if (showSelector) {
    return (
      <div className="flex w-full flex-col items-center gap-5 lg:gap-6">
        <h2 className="text-xl lg:text-2xl font-bold tracking-wide text-white text-center">
          Choose a service
        </h2>
        {enabledModes.map((mode: KioskMode) => (
          <button
            key={mode.id}
            onClick={() => {
              if (mode.id === 'standard') {
                setSelectedMode('standard')
              } else if (mode.id === 'school_offline') {
                router.push(`/kiosk/${kioskId}/mode2`)
              }
            }}
            className="w-full max-w-[400px] rounded-3xl border border-white/10 bg-[#3a4354]/90 px-8 py-8 lg:py-10 text-left shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-2xl transition-all duration-300 hover:border-teal-400/50 hover:bg-[#163b3e]/90 hover:scale-[1.02] active:scale-[0.99]"
          >
            <span className="block text-2xl lg:text-3xl font-bold text-white">
              {mode.label}
            </span>
            {mode.id === 'school_offline' && (
              <span className="mt-2 block text-sm lg:text-base text-teal-300">
                {mode.client.name}
              </span>
            )}
            {mode.id === 'standard' && (
              <span className="mt-2 block text-sm lg:text-base text-zinc-400">
                Scan the QR with your phone
              </span>
            )}
          </button>
        ))}
      </div>
    )
  }

  return (
    <>
      <div className="rounded-3xl lg:rounded-[2.5rem] border border-white/10 bg-[#3a4354]/90 p-6 lg:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-2xl w-full max-w-[400px] lg:max-w-none mx-auto flex items-center justify-center transition-all duration-500 scale-100 opacity-100">
        <div className="rounded-xl bg-white p-4 flex items-center justify-center w-full aspect-square">
          <QRCodeSVG
            value={qrUrl}
            size={400}
            level="M"
            bgColor="#ffffff"
            fgColor="#000000"
            style={{ width: "100%", height: "100%", maxWidth: "400px" }}
          />
        </div>
      </div>

      <div className="mt-6 lg:mt-8 flex flex-col items-center text-center transition-opacity duration-500 delay-200">
        <div className="flex items-center gap-2 text-zinc-300 text-sm lg:text-base bg-black/30 border border-white/5 rounded-full px-5 lg:px-6 py-2.5 lg:py-3 shadow-inner backdrop-blur-md">
          <div className="h-2 w-2 lg:h-2.5 lg:w-2.5 rounded-full bg-teal-400 animate-pulse shadow-[0_0_8px_rgba(45,212,191,0.8)]" />
          <span className="tracking-wide">QR Refreshes in <strong className="font-bold text-teal-400 font-jakarta">{Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}</strong></span>
        </div>
        {selectedMode === 'standard' && enabledModes !== null && enabledModes.length >= 2 && (
          <button
            onClick={() => setSelectedMode(null)}
            className="mt-4 flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm text-zinc-300 transition hover:bg-white/10 hover:text-white"
          >
            ← Back to services
          </button>
        )}
      </div>
    </>
  )
}
