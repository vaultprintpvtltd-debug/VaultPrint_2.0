'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import { useKioskRealtime } from '@/hooks/use-kiosk-realtime'

const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN || 'https://vaultprint-mobile.vercel.app'

export default function KioskQRPage() {
  const params = useParams<{ kioskId: string }>()
  const kioskId = params.kioskId

  const [qrTimestamp, setQrTimestamp] = useState(Date.now())
  const [timeLeft, setTimeLeft] = useState(300)

  // ── Realtime subscription ──────────────────────────────────────────────
  useKioskRealtime(kioskId)

  // ── QR regeneration (every 5 minutes with live countdown) ──────────────
  useEffect(() => {
    const qrInterval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          setQrTimestamp(Date.now())
          return 300
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(qrInterval)
  }, [])

  const qrUrl = `${APP_DOMAIN}/start?k=${kioskId}&t=${qrTimestamp}`

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
      </div>
    </>
  )
}
