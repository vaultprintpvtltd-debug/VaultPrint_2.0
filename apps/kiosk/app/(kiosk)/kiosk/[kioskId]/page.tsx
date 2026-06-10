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
  const hours = currentTime.getHours() % 12 || 12
  const minutes = currentTime.getMinutes().toString().padStart(2, '0')
  const ampm = currentTime.getHours() >= 12 ? 'PM' : 'AM'
  const formattedTime = `${hours} : ${minutes} ${ampm}`

  // ── Loading state ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950 font-jakarta">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-zinc-700 border-t-teal-400" />
          <p className="text-lg text-zinc-400">Connecting to VaultPrint…</p>
        </div>
      </div>
    )
  }

  // ── Error state ────────────────────────────────────────────────────────
  if (error || !kioskInfo) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950 font-jakarta">
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
    <div className="relative flex h-screen w-screen flex-col items-center overflow-hidden bg-[#09090b] text-zinc-100 select-none bg-[url('/bg_kiosk.svg')] bg-cover bg-center bg-no-repeat font-jakarta">

      {/* Background Printer Image */}
      <img src="/printer_bg.svg" alt="" className="absolute bottom-0 right-0 w-[600px] opacity-80 pointer-events-none" />

      {/* Main Glassmorphism Container */}
      <div className="relative mt-12 flex h-[85%] w-[90%] max-w-6xl flex-col rounded-[2.5rem] border border-white/10 bg-white/5 p-10 shadow-2xl backdrop-blur-xl">

        {/* Top Header Row inside the card */}
        <header className="flex items-center justify-between pb-8">
          <div className="flex items-center gap-4">
            <img src="/LOGO.svg" alt="VaultPrint Logo" className="h-14 w-auto" />
            <div className="flex flex-col justify-center">
              <h1 className="text-2xl font-bold tracking-tight text-white leading-none">Vault<br />Print</h1>
            </div>
          </div>

          {/* Status Pill */}
          <div className="flex items-center gap-3 rounded-full border border-white/5 bg-black/40 px-8 py-3 shadow-inner">
            <div
              className={`h-3 w-3 rounded-full ${kioskInfo.status === 'online' || kioskInfo.status === 'idle'
                  ? 'bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.8)]'
                  : kioskInfo.status === 'printing'
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-red-500'
                }`}
            />
            <span className="text-sm font-semibold tracking-wider text-zinc-300 uppercase">
              PRINTER : {kioskInfo.status}
            </span>
          </div>

          {/* Time Pill */}
          <div className="rounded-full border border-white/5 bg-black/40 px-8 py-3 shadow-inner">
            <span className="font-jakarta text-sm font-semibold tracking-wide text-zinc-300 uppercase">
              {formattedTime} IST
            </span>
          </div>
        </header>

        {/* Divider */}
        <div className="mb-12 h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        {/* Two-column layout */}
        <main className="flex flex-1 items-center justify-between px-16">

          {/* Left: Stepper */}
          <div className="flex flex-col gap-10 w-[45%] relative">
            {/* Vertical Line Base */}
            <div className="absolute left-[1.35rem] top-10 bottom-10 w-[3px] bg-white/10" />
            {/* Vertical Line Active Part */}
            <div className="absolute left-[1.35rem] top-10 h-[40%] w-[3px] bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.5)]" />

            {/* Step 1 */}
            <div className="relative z-10 flex items-center gap-6 rounded-[2rem] border border-white/10 bg-[#163b3e]/80 px-8 py-6 shadow-lg backdrop-blur-md">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-teal-400 shadow-[0_0_15px_rgba(45,212,191,0.8)]" />
              <div>
                <h3 className="text-3xl font-semibold text-white mb-1">Scan the QR</h3>
                <p className="text-sm text-teal-100/70">with your phone camera to start printing</p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="relative z-10 flex items-center gap-6 rounded-[2rem] border border-dashed border-white/10 bg-black/20 px-8 py-6">
              <div className="h-12 w-12 shrink-0 rounded-full bg-zinc-300" />
              <div>
                <h3 className="text-3xl font-semibold text-zinc-300 mb-1">Upload & Pay</h3>
                <p className="text-sm text-zinc-500">Select files and printing options</p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="relative z-10 flex items-center gap-6 rounded-[2rem] border border-dashed border-white/10 bg-black/20 px-8 py-6">
              <div className="h-12 w-12 shrink-0 rounded-full bg-zinc-300" />
              <div>
                <h3 className="text-3xl font-semibold text-zinc-300 mb-1">Verify & Print</h3>
                <p className="text-sm text-zinc-500">Enter the 6-digit OTP shown on your phone</p>
              </div>
            </div>
          </div>

          {/* Right: QR Code Box */}
          <div className="flex w-[45%] flex-col items-center justify-center">
            <div className="rounded-[2.5rem] border border-white/10 bg-[#3a4354]/90 p-12 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
              <div className="rounded-xl bg-white p-4 flex items-center justify-center">
                <QRCodeSVG
                  value={qrUrl}
                  size={360}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#000000"
                  style={{ width: 360, height: 360 }}
                />
              </div>
            </div>
          </div>

        </main>
      </div>
    </div>
  )
}
