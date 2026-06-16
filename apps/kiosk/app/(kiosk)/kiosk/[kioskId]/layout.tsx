'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, usePathname } from 'next/navigation'
import Image from 'next/image'
import { createBrowserClient } from '@vaultprint/db'

interface KioskInfo {
  name: string
  location: string | null
  status: string
}

export default function KioskLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ kioskId: string }>()
  const pathname = usePathname()
  const kioskId = params.kioskId

  const [kioskInfo, setKioskInfo] = useState<KioskInfo | null>(null)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
    <div className="relative flex min-h-screen sm:h-screen w-screen flex-col items-center overflow-x-hidden overflow-y-auto sm:overflow-hidden bg-[#09090b] text-zinc-100 select-none bg-[url('/bg_kiosk.svg')] bg-cover bg-center bg-no-repeat font-jakarta pb-6 sm:pb-0">

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
      <div className="relative mt-6 sm:mt-8 lg:mt-12 flex flex-1 sm:flex-none sm:h-[80%] min-h-[fit-content] w-[95%] lg:w-[90%] max-w-6xl flex-col rounded-3xl lg:rounded-[2.5rem] border border-white/10 bg-white/5 p-6 lg:p-10 shadow-2xl backdrop-blur-xl z-10 mb-4 sm:mb-0">

        {/* Top Header Row inside the card */}
        <header className="flex flex-row items-center justify-between pb-4 sm:pb-6 lg:pb-8 gap-4">
          <div className="flex items-center gap-3 lg:gap-4 rounded-full border border-white/10 bg-white/5 px-5 py-2.5 lg:px-6 lg:py-3 shadow-inner backdrop-blur-md">
            <Image
              src="/LOGO.svg"
              alt="VaultPrint Logo"
              width={200}
              height={40}
              className="h-8 lg:h-10 w-auto"
              style={{ width: 'auto' }}
            />
            <h1 className="text-lg lg:text-xl font-bold tracking-tight text-white leading-none">VaultPrint</h1>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            {/* Status Pill */}
            <div className="flex items-center gap-2.5 lg:gap-3 rounded-full border border-white/5 bg-black/40 px-6 lg:px-8 py-2.5 lg:py-3 shadow-inner">
              <div
                className={`h-2.5 w-2.5 lg:h-3 lg:w-3 rounded-full ${kioskInfo.status === 'online' || kioskInfo.status === 'idle'
                  ? 'bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.8)]'
                  : kioskInfo.status === 'printing'
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-red-500'
                  }`}
              />
              <span className="text-xs lg:text-sm font-semibold tracking-wider text-zinc-300 uppercase">
                PRINTER : {kioskInfo.status}
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
        <div className="mb-8 lg:mb-12 h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent flex-shrink-0" />

        {/* Two-column layout */}
        <main className="flex flex-row flex-1 items-center justify-between px-2 sm:px-8 lg:px-16 gap-6 sm:gap-8 lg:gap-0">

          {/* Left: Stepper */}
          <div className="flex flex-col gap-6 sm:gap-10 lg:gap-12 w-1/2 lg:w-[45%] pr-4 sm:pr-0">
            <div className="mb-1 text-left">
              <h1 className="text-xl sm:text-3xl lg:text-4xl font-extrabold tracking-widest text-teal-400 uppercase leading-tight">How It Works</h1>
              <p className="text-xs sm:text-sm lg:text-base text-zinc-400 mt-1 sm:mt-2">Get your documents printed in three simple steps</p>
            </div>

            <div className="flex flex-col gap-4 sm:gap-8 lg:gap-10 relative">
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
              <div className={`relative z-10 flex flex-row items-center text-left gap-3 sm:gap-4 lg:gap-6 rounded-2xl sm:rounded-[2rem] border px-3 py-3 sm:px-6 sm:py-4 lg:px-8 lg:py-5 shadow-lg backdrop-blur-md transition-all duration-300 ${isStep1 ? 'border-white/20 bg-[#163b3e]/90 scale-[1.02] opacity-100' :
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
              <div className={`relative z-10 flex flex-row items-center text-left gap-3 sm:gap-4 lg:gap-6 rounded-2xl sm:rounded-[2rem] border px-3 py-3 sm:px-6 sm:py-4 lg:px-8 lg:py-5 shadow-lg backdrop-blur-md transition-all duration-300 ${isStep2 ? 'border-white/20 bg-[#163b3e]/90 scale-[1.02] opacity-100' :
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
              <div className={`relative z-10 flex flex-row items-center text-left gap-3 sm:gap-4 lg:gap-6 rounded-2xl sm:rounded-[2rem] border px-3 py-3 sm:px-6 sm:py-4 lg:px-8 lg:py-5 shadow-lg backdrop-blur-md transition-all duration-300 ${isStep3 ? 'border-white/20 bg-[#163b3e]/90 scale-[1.02] opacity-100' : 'border-dashed border-white/10 bg-black/20 opacity-60'
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
          <div className="flex w-1/2 lg:w-[45%] flex-col items-center justify-center mt-0 lg:mt-10">
            {children}
          </div>

        </main>
      </div>

      {/* Glassmorphism Footer */}
      <footer className="relative sm:absolute sm:bottom-6 lg:bottom-8 flex w-[95%] lg:w-[90%] max-w-6xl flex-row items-center justify-between gap-2 sm:gap-4 rounded-xl sm:rounded-2xl border border-white/10 bg-white/5 px-4 sm:px-6 lg:px-12 py-3 lg:py-5 shadow-xl backdrop-blur-xl z-10 shrink-0">
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
