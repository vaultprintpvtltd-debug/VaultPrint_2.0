'use client'

import { useEffect, useState } from 'react'
import { useParams, usePathname } from 'next/navigation'
import Image from 'next/image'
import { createBrowserClient } from '@vaultprint/db'
import { provisionKioskApiKeyFromUrl } from '@/lib/kiosk-api'
import { StaffUnlock } from '@/components/staff-unlock'

interface KioskInfo {
  name: string
  location: string | null
  status: string
  last_heartbeat: string | null
  printer_state: string | null
}

// Agent heartbeats every 30 s; older than this = kiosk offline
const AGENT_ONLINE_WINDOW_MS = 2 * 60 * 1000

/** Status pill text + colour from the agent's latest printer report. */
function printerPill(info: KioskInfo): { label: string; tone: 'ok' | 'busy' | 'bad' } {
  const fresh = info.last_heartbeat && Date.now() - new Date(info.last_heartbeat).getTime() < AGENT_ONLINE_WINDOW_MS
  if (!fresh) return { label: 'Offline', tone: 'bad' }
  switch (info.printer_state) {
    case 'ready': return { label: 'Ready', tone: 'ok' }
    case 'printing': return { label: 'Printing', tone: 'busy' }
    case 'paper_out': return { label: 'Out of paper', tone: 'bad' }
    case 'not_connected': return { label: 'Not connected', tone: 'bad' }
    case 'error': return { label: 'Needs attention', tone: 'bad' }
    default:
      return info.status === 'printing' ? { label: 'Printing', tone: 'busy' } : { label: 'Ready', tone: 'ok' }
  }
}

export default function KioskLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ kioskId: string }>()
  const pathname = usePathname()
  const kioskId = params.kioskId

  const [kioskInfo, setKioskInfo] = useState<KioskInfo | null>(null)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── One-time device provisioning: /kiosk/[id]?key=<KIOSK_API_KEY> ─────
  // Stores the kiosk API key (used by the OTP pad and Mode 2 screens) and
  // strips it from the URL.
  useEffect(() => {
    provisionKioskApiKeyFromUrl()
  }, [])

  // ── Installable full-screen app (Android box kiosk mode) ───────────────
  // The service worker is required for installability on the box's Chrome
  // and shows a self-reloading "Reconnecting…" screen when offline.
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/kiosk-sw.js', { scope: '/kiosk/' }).catch(() => {})
    }
  }, [])

  // ── Browser full-screen on touch (hides Chrome's address bar + tabs) ───
  // Browsers only allow full-screen from a user gesture — for touch that is
  // the END of a tap (pointerup), not pointerdown — and Back exits it, so
  // every tap re-enters it. The box locks Chrome to this site anyway
  // (agent/android/kiosk.sh).
  useEffect(() => {
    const enterFullscreen = () => {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
      }
    }
    document.addEventListener('pointerup', enterFullscreen)
    return () => document.removeEventListener('pointerup', enterFullscreen)
  }, [])

  // React hoists these into <head>
  const appHead = (
    <>
      <link rel="manifest" href={`/kiosk/${kioskId}/manifest.webmanifest`} />
      <meta name="theme-color" content="#09090b" />
    </>
  )

  // ── Fetch kiosk info from Supabase ─────────────────────────────────────
  useEffect(() => {
    const fetchKioskInfo = async () => {
      try {
        const supabase = createBrowserClient()
        let { data, error: fetchError } = await supabase
          .from('kiosks')
          .select('name, location, status, last_heartbeat, printer_state')
          .eq('id', kioskId)
          .single()
        // Database without migration 008 (no printer_state column yet)
        if (fetchError) {
          const fallback = await supabase
            .from('kiosks')
            .select('name, location, status, last_heartbeat')
            .eq('id', kioskId)
            .single()
          data = fallback.data ? { ...fallback.data, printer_state: null } : null
          fetchError = fallback.error
        }

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
    }
    fetchKioskInfo()
    // Keep the printer status pill current
    const refresh = setInterval(fetchKioskInfo, 15000)
    return () => clearInterval(refresh)
  }, [kioskId])

  // ── Live clock (updates every second) ──────────────────────────────────
  useEffect(() => {
    const clockInterval = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)

    return () => clearInterval(clockInterval)
  }, [])

  // ── Formatted time ─────────────────────────────────────────────────────
  const hours = currentTime.getHours() % 12 || 12
  const minutes = currentTime.getMinutes().toString().padStart(2, '0')
  const seconds = currentTime.getSeconds().toString().padStart(2, '0')
  const ampm = currentTime.getHours() >= 12 ? 'PM' : 'AM'
  const formattedTime = `${hours} : ${minutes} : ${seconds} ${ampm}`

  // ── Determine Active Step ──────────────────────────────────────────────
  const isStep1 = pathname === `/kiosk/${kioskId}`
  const isStep2 = pathname === `/kiosk/${kioskId}/upload`
  const isStep3 = pathname === `/kiosk/${kioskId}/enter-otp`

  // ── Loading state ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950 font-jakarta">
        {appHead}
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

  // ── Main UI Layout ─────────────────────────────────────────────────────
  return (
    // fixed + inset-0: exactly the visible window, whatever 100vh means on
    // the box's Chrome 101 (it is taller than the full-screen viewport there)
    <div className="fixed inset-0 flex flex-col items-center gap-[2vh] overflow-hidden p-[2.5vh] bg-[#09090b] text-zinc-100 select-none bg-[url('/bg_kiosk.svg')] bg-cover bg-center bg-no-repeat font-jakarta">

      {appHead}

      {/* Background Printer Image */}
      <Image
        src="/printer_bg.svg"
        alt=""
        width={600}
        height={600}
        className="absolute bottom-0 right-0 w-[300px] lg:w-[600px] h-auto opacity-80 pointer-events-none"
        style={{ height: 'auto' }}
        priority={true}
      />

      {/* Main Glassmorphism Container */}
      <div className="relative flex min-h-0 flex-1 w-[95%] lg:w-[90%] max-w-6xl flex-col rounded-3xl lg:rounded-[2.5rem] border border-white/10 bg-white/5 px-[4vh] py-[3vh] shadow-2xl backdrop-blur-xl z-10">

        {/* Top Header Row inside the card */}
        <header className="flex shrink-0 flex-row items-center justify-between pb-[2vh] gap-4">
          {/* Hold the logo 5 s → staff unlock (kiosk lock on the Android box) */}
          <StaffUnlock>
            <div className="flex items-center gap-3 lg:gap-4 rounded-full border border-white/10 bg-white/5 px-5 py-2.5 lg:px-6 lg:py-3 shadow-inner backdrop-blur-md">
              <Image
                src="/LOGO.svg"
                alt="VaultPrint Logo"
                width={200}
                height={40}
                className="h-8 lg:h-10 w-auto"
                style={{ width: 'auto' }}
                draggable={false}
              />
              <h1 className="text-lg lg:text-xl font-bold tracking-tight text-white leading-none">VaultPrint</h1>
            </div>
          </StaffUnlock>

          <div className="flex flex-wrap items-center justify-center gap-3">
            {/* Status Pill */}
            <div className="flex items-center gap-2.5 lg:gap-3 rounded-full border border-white/5 bg-black/40 px-6 lg:px-8 py-2.5 lg:py-3 shadow-inner">
              <div
                className={`h-2.5 w-2.5 lg:h-3 lg:w-3 rounded-full ${printerPill(kioskInfo).tone === 'ok'
                  ? 'bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.8)]'
                  : printerPill(kioskInfo).tone === 'busy'
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-red-500'
                  }`}
              />
              <span className="text-xs lg:text-sm font-semibold tracking-wider text-zinc-300 uppercase">
                PRINTER : {printerPill(kioskInfo).label}
              </span>
            </div>

            {/* Time Pill */}
            <div className="flex items-center justify-center min-w-[140px] lg:min-w-[170px] rounded-full border border-white/5 bg-black/40 px-6 lg:px-8 py-2.5 lg:py-3 shadow-inner">
              <span className="font-jakarta text-xs lg:text-sm font-semibold tracking-wide text-zinc-300 uppercase tabular-nums">
                {formattedTime} IST
              </span>
            </div>
          </div>
        </header>

        {/* Divider */}
        <div className="mb-[2.5vh] h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent flex-shrink-0" />

        {/* Two-column layout */}
        <main className="flex min-h-0 flex-1 flex-row items-center justify-between px-2 sm:px-8 lg:px-12 gap-6 sm:gap-8">

          {/* Left: Stepper */}
          <div className="flex flex-col justify-center gap-[3.5vh] w-1/2 lg:w-[45%] pr-4 sm:pr-0">
            <div className="mb-1 text-left">
              <h1 className="text-xl sm:text-3xl lg:text-4xl font-extrabold tracking-widest text-teal-400 uppercase leading-tight">How It Works</h1>
              <p className="text-xs sm:text-sm lg:text-base text-zinc-400 mt-1 sm:mt-2">Get your documents printed in three simple steps</p>
            </div>

            <div className="flex flex-col gap-[3vh] relative">
              {/* Vertical Line Container */}
              <div className="absolute left-[33px] sm:left-[49px] lg:left-[57px] top-[30px] sm:top-[41px] lg:top-[45px] bottom-[30px] sm:bottom-[41px] lg:bottom-[45px] w-[2px] sm:w-[3px] -translate-x-1/2 z-0">
                {/* Base Line */}
                <div className="absolute inset-0 bg-white/10" />

                {/* Active Line */}
                <div
                  className={`absolute top-0 w-full bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.5)] transition-all duration-500 ${isStep1 ? 'h-[35%]' : isStep2 ? 'h-[85%]' : 'h-[100%]'
                    }`}
                  style={{
                    WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 60%, transparent 100%)',
                    maskImage: 'linear-gradient(to bottom, black 0%, black 60%, transparent 100%)'
                  }}
                />
              </div>

              {/* Step 1 */}
              <div className={`relative z-10 flex flex-row items-center text-left gap-3 sm:gap-4 lg:gap-6 rounded-2xl sm:rounded-[2rem] border px-3 sm:px-6 lg:px-8 py-[1.8vh] shadow-lg backdrop-blur-md transition-all duration-300 ${isStep1 ? 'border-white/20 bg-[#163b3e]/90 scale-[1.02] opacity-100' :
                  (isStep2 || isStep3) ? 'border-teal-500/30 bg-black/40 opacity-100' :
                    'border-white/5 bg-black/20 opacity-60'
                }`}>
                <div className={`flex h-8 w-8 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-full transition-colors font-bold text-sm sm:text-lg ${isStep1 ? 'bg-teal-400 text-teal-950 shadow-[0_0_15px_rgba(45,212,191,0.8)]' :
                    (isStep2 || isStep3) ? 'bg-teal-400 text-teal-950' : 'bg-teal-900/50 text-teal-400'
                  }`}>
                  {(isStep2 || isStep3) ? (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : <span>1</span>}
                </div>
                <div>
                  <h3 className={`text-sm sm:text-xl lg:text-2xl font-semibold mb-0 sm:mb-1 leading-tight ${isStep1 ? 'text-white' : 'text-zinc-300'}`}>Scan the QR</h3>
                  <p className={`text-[10px] sm:text-xs lg:text-sm leading-tight ${isStep1 ? 'text-teal-100/70' : 'text-zinc-500'}`}>with your phone camera to start printing</p>
                </div>
              </div>

              {/* Step 2 */}
              <div className={`relative z-10 flex flex-row items-center text-left gap-3 sm:gap-4 lg:gap-6 rounded-2xl sm:rounded-[2rem] border px-3 sm:px-6 lg:px-8 py-[1.8vh] shadow-lg backdrop-blur-md transition-all duration-300 ${isStep2 ? 'border-white/20 bg-[#163b3e]/90 scale-[1.02] opacity-100' :
                  isStep3 ? 'border-teal-500/30 bg-black/40 opacity-100' :
                    'border-dashed border-white/10 bg-black/20 opacity-60'
                }`}>
                <div className={`flex h-8 w-8 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-full transition-colors font-bold text-sm sm:text-lg ${isStep2 ? 'bg-teal-400 text-teal-950 shadow-[0_0_15px_rgba(45,212,191,0.8)]' :
                    isStep3 ? 'bg-teal-400 text-teal-950' : 'bg-zinc-800 text-zinc-400'
                  }`}>
                  {isStep3 ? (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : <span>2</span>}
                </div>
                <div>
                  <h3 className={`text-sm sm:text-xl lg:text-2xl font-semibold mb-0 sm:mb-1 leading-tight ${isStep2 ? 'text-white' : 'text-zinc-300'}`}>Upload & Pay</h3>
                  <p className={`text-[10px] sm:text-xs lg:text-sm leading-tight ${isStep2 ? 'text-teal-100/70' : 'text-zinc-500'}`}>Select files and printing options</p>
                </div>
              </div>

              {/* Step 3 */}
              <div className={`relative z-10 flex flex-row items-center text-left gap-3 sm:gap-4 lg:gap-6 rounded-2xl sm:rounded-[2rem] border px-3 sm:px-6 lg:px-8 py-[1.8vh] shadow-lg backdrop-blur-md transition-all duration-300 ${isStep3 ? 'border-white/20 bg-[#163b3e]/90 scale-[1.02] opacity-100' : 'border-dashed border-white/10 bg-black/20 opacity-60'
                }`}>
                <div className={`flex h-8 w-8 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-full transition-colors font-bold text-sm sm:text-lg ${isStep3 ? 'bg-teal-400 text-teal-950 shadow-[0_0_15px_rgba(45,212,191,0.8)]' : 'bg-zinc-800 text-zinc-400'
                  }`}>
                  <span>3</span>
                </div>
                <div>
                  <h3 className={`text-sm sm:text-xl lg:text-2xl font-semibold mb-0 sm:mb-1 leading-tight ${isStep3 ? 'text-white' : 'text-zinc-300'}`}>Verify & Print</h3>
                  <p className={`text-[10px] sm:text-xs lg:text-sm leading-tight ${isStep3 ? 'text-teal-100/70' : 'text-zinc-500'}`}>Enter the 6-digit OTP shown on your phone</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Dynamic Content Area */}
          <div className="flex h-full min-h-0 w-1/2 lg:w-[45%] flex-col items-center justify-center">
            {children}
          </div>

        </main>
      </div>

      {/* Glassmorphism Footer */}
      <footer className="relative flex w-[95%] lg:w-[90%] max-w-6xl flex-row items-center justify-between gap-2 sm:gap-4 rounded-xl sm:rounded-2xl border border-white/10 bg-white/5 px-4 sm:px-6 lg:px-12 py-[1.8vh] shadow-xl backdrop-blur-xl z-10 shrink-0">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-0 sm:gap-3 text-left">
          <span className="text-xs sm:text-sm font-medium tracking-wider text-zinc-400 uppercase">Kiosk ID</span>
          <div className="hidden sm:block h-4 w-px bg-white/20" />
          <span className="font-jakarta text-sm font-bold tracking-widest text-teal-400 break-all">{kioskId}</span>
        </div>
        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-0 sm:gap-3 text-right">
          <span className="text-xs sm:text-sm font-medium tracking-wider text-zinc-400 uppercase">Location</span>
          <div className="hidden sm:block h-4 w-px bg-white/20" />
          <span className="font-jakarta text-sm font-bold tracking-wide text-zinc-200 uppercase">{kioskInfo.location || 'Not Configured'}</span>
        </div>
      </footer>

    </div>
  )
}
