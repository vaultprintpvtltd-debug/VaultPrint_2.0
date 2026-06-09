'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import { createBrowserClient } from '@vaultprint/db'
import { useKioskRealtime } from '@/hooks/use-kiosk-realtime'

// ---------------------------------------------------------------------------
// /kiosk/[kioskId] — Idle / QR Screen
//
// Full-screen kiosk display designed for Chrome --kiosk mode on 1080p screens.
// Shows a large QR code that users scan with their phone to start a print job.
//
// Key behaviours:
//   - QR encodes: https://app.vaultprintpvtltd.online/start?k=[kioskId]
//   - QR regenerates every 5 minutes (cache-bust via timestamp param)
//   - Header shows kiosk name + live clock
//   - Supabase Realtime: auto-navigates to /enter-otp when a job is queued
//   - Bottom status bar shows printer status and last job time
// ---------------------------------------------------------------------------

const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN || 'https://vaultprint-mobile.vercel.app'
const QR_REFRESH_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

interface KioskInfo {
  name: string
  location: string | null
  status: string
}

export default function KioskQRPage() {
  const params = useParams<{ kioskId: string }>()
  const kioskId = params.kioskId

  // ── State ──────────────────────────────────────────────────────────────
  const [kioskInfo, setKioskInfo] = useState<KioskInfo | null>(null)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [qrTimestamp, setQrTimestamp] = useState(Date.now())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── Realtime subscription ──────────────────────────────────────────────
  // Navigates to /kiosk/[kioskId]/enter-otp when a job becomes 'queued'.
  useKioskRealtime(kioskId)

  // ── Fetch kiosk info from Supabase ─────────────────────────────────────
  const fetchKioskInfo = useCallback(async () => {
    try {
      const supabase = createBrowserClient()
      const { data, error: fetchError } = await supabase
        .from('kiosks')
        .select('name, location, status')
        .eq('id', kioskId)
        .single()

      if (fetchError || !data) {
        setError('Kiosk not found. Please check the kiosk ID.')
        setLoading(false)
        return
      }

      setKioskInfo(data)
      setLoading(false)
    } catch {
      setError('Failed to connect to server.')
      setLoading(false)
    }
  }, [kioskId])

  useEffect(() => {
    fetchKioskInfo()
  }, [fetchKioskInfo])

  // ── Live clock (updates every second) ──────────────────────────────────
  useEffect(() => {
    const clockInterval = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)

    return () => clearInterval(clockInterval)
  }, [])

  // ── QR regeneration (every 5 minutes) ──────────────────────────────────
  // Adding a timestamp query param to the QR URL forces phones to treat
  // each scan as a fresh session and prevents browser caching.
  useEffect(() => {
    const qrInterval = setInterval(() => {
      setQrTimestamp(Date.now())
    }, QR_REFRESH_INTERVAL_MS)

    return () => clearInterval(qrInterval)
  }, [])

  // ── QR URL ─────────────────────────────────────────────────────────────
  const qrUrl = `${APP_DOMAIN}/start?k=${kioskId}&t=${qrTimestamp}`

  // ── Formatted time ─────────────────────────────────────────────────────
  const formattedTime = currentTime.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })

  const formattedDate = currentTime.toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  // ── Loading state ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-zinc-700 border-t-emerald-500" />
          <p className="text-lg text-zinc-400">Connecting to VaultPrint…</p>
        </div>
      </div>
    )
  }

  // ── Error state ────────────────────────────────────────────────────────
  if (error || !kioskInfo) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
            <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-zinc-100">Kiosk Unavailable</h1>
          <p className="max-w-md text-zinc-400">{error || 'An unknown error occurred.'}</p>
        </div>
      </div>
    )
  }

  // ── Main QR Display ────────────────────────────────────────────────────
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100 select-none">

      {/* ── HEADER BAR ───────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-8 py-4 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          {/* VaultPrint Logo / Brand */}
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
            <svg className="h-6 w-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-zinc-100">VaultPrint</h1>
            <p className="text-sm text-zinc-400">{kioskInfo.name}</p>
          </div>
        </div>

        <div className="text-right">
          <p className="text-xl font-semibold tabular-nums tracking-wide text-zinc-100">
            {formattedTime}
          </p>
          <p className="text-sm text-zinc-500">{formattedDate}</p>
        </div>
      </header>

      {/* ── MAIN CONTENT ─────────────────────────────────────────────── */}
      <main className="flex flex-1 items-center justify-center gap-16 px-8">

        {/* ── QR Code Section ──────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-6">
          <div className="rounded-3xl border border-zinc-800 bg-white p-6 shadow-2xl shadow-emerald-500/5">
            <QRCodeSVG
              value={qrUrl}
              size={320}
              level="M"
              bgColor="#ffffff"
              fgColor="#09090b"
              style={{ width: 320, height: 320 }}
            />
          </div>
          <p className="text-sm text-zinc-500">
            QR refreshes automatically every 5 minutes
          </p>
        </div>

        {/* ── Instructions Section ─────────────────────────────────── */}
        <div className="flex max-w-md flex-col gap-8">
          <div>
            <h2 className="mb-2 text-3xl font-bold tracking-tight text-zinc-100">
              Print Your Document
            </h2>
            <p className="text-lg text-zinc-400">
              Scan the QR code with your phone to get started. No app required.
            </p>
          </div>

          {/* Step-by-step instructions */}
          <div className="flex flex-col gap-6">
            <InstructionStep
              step={1}
              title="Scan QR Code"
              description="Open your phone camera and scan the QR code on the left."
            />
            <InstructionStep
              step={2}
              title="Upload & Pay"
              description="Upload your PDF, choose settings, and pay securely via Razorpay."
            />
            <InstructionStep
              step={3}
              title="Enter OTP"
              description="Enter the 6-digit code shown on your phone into this kiosk."
            />
          </div>
        </div>
      </main>

      {/* ── STATUS BAR ───────────────────────────────────────────────── */}
      <footer className="flex shrink-0 items-center justify-between border-t border-zinc-800 bg-zinc-900/80 px-8 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div
            className={`h-2.5 w-2.5 rounded-full ${
              kioskInfo.status === 'online' || kioskInfo.status === 'idle'
                ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50'
                : kioskInfo.status === 'printing'
                ? 'bg-amber-500 shadow-sm shadow-amber-500/50 animate-pulse'
                : 'bg-red-500 shadow-sm shadow-red-500/50'
            }`}
          />
          <span className="text-sm text-zinc-400">
            Printer:{' '}
            <span className="font-medium text-zinc-300 capitalize">
              {kioskInfo.status}
            </span>
          </span>
        </div>

        {kioskInfo.location && (
          <span className="text-sm text-zinc-500">
            📍 {kioskInfo.location}
          </span>
        )}

        <span className="text-xs text-zinc-600">
          Kiosk ID: {kioskId.slice(0, 8)}…
        </span>
      </footer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// InstructionStep — Reusable component for the 3-step instruction strip
// ---------------------------------------------------------------------------

function InstructionStep({
  step,
  title,
  description,
}: {
  step: number
  title: string
  description: string
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-lg font-bold text-emerald-500">
        {step}
      </div>
      <div>
        <h3 className="text-lg font-semibold text-zinc-100">{title}</h3>
        <p className="text-sm text-zinc-400">{description}</p>
      </div>
    </div>
  )
}
