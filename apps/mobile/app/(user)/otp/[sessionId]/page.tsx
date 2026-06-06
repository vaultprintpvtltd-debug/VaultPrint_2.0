'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

// ---------------------------------------------------------------------------
// /otp/[sessionId] — OTP Display Page
// Shows the 6-digit OTP, 15-minute countdown, copy button.
// Polls /api/jobs/[id]/status every 4s — redirects to /done on completed.
// ---------------------------------------------------------------------------

export default function OTPPage() {
  const params = useParams<{ sessionId: string }>()
  const router = useRouter()
  const sessionId = params.sessionId

  const [otp, setOtp] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [timeLeft, setTimeLeft] = useState<number>(0)
  const [copied, setCopied] = useState(false)
  const [status, setStatus] = useState<string>('queued')

  // Load OTP from sessionStorage
  useEffect(() => {
    const stored = sessionStorage.getItem(`vp_otp_${sessionId}`)
    if (stored) {
      const { otp: storedOtp, expires_at } = JSON.parse(stored)
      setOtp(storedOtp)
      setExpiresAt(expires_at)
    }
  }, [sessionId])

  // Countdown timer
  useEffect(() => {
    if (!expiresAt) return
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
      setTimeLeft(remaining)
      if (remaining <= 0) clearInterval(interval)
    }, 1000)
    return () => clearInterval(interval)
  }, [expiresAt])

  // Poll job status every 4s
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${sessionId}/status`)
        if (res.ok) {
          const data = await res.json()
          setStatus(data.status)
          if (data.status === 'completed') {
            clearInterval(interval)
            router.push(`/done/${sessionId}`)
          }
          if (data.status === 'failed' || data.status === 'expired') {
            clearInterval(interval)
          }
        }
      } catch {}
    }, 4000)
    return () => clearInterval(interval)
  }, [sessionId, router])

  const minutes = Math.floor(timeLeft / 60)
  const seconds = timeLeft % 60

  async function copyOTP() {
    if (!otp) return
    await navigator.clipboard.writeText(otp)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!otp) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        No OTP found. Please complete payment first.
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/80 p-4">
        <h1 className="text-lg font-bold">VaultPrint</h1>
        <p className="text-sm text-zinc-400">Your Print Code</p>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center p-6">
        {/* OTP Display */}
        <div className="mb-6 text-center">
          <p className="mb-2 text-sm text-zinc-400">Enter this code at the kiosk</p>
          <div className="flex gap-2 justify-center">
            {otp.split('').map((digit, i) => (
              <div
                key={i}
                className="flex h-14 w-11 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-2xl font-bold tabular-nums text-emerald-400"
              >
                {digit}
              </div>
            ))}
          </div>
        </div>

        {/* Copy Button */}
        <button
          onClick={copyOTP}
          className="mb-6 rounded-lg border border-zinc-700 bg-zinc-900 px-6 py-2 text-sm text-zinc-300 transition hover:border-zinc-500"
        >
          {copied ? '✓ Copied!' : 'Copy Code'}
        </button>

        {/* Countdown */}
        <div className="mb-8 text-center">
          {timeLeft > 0 ? (
            <>
              <p className="text-sm text-zinc-400">Expires in</p>
              <p className="text-2xl font-bold tabular-nums text-zinc-200">
                {minutes}:{seconds.toString().padStart(2, '0')}
              </p>
            </>
          ) : (
            <p className="text-sm text-red-400">Code expired</p>
          )}
        </div>

        {/* Status */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-center text-sm">
          <p className="text-zinc-400">Status: <span className="font-medium text-zinc-200 capitalize">{status}</span></p>
          {status === 'queued' && <p className="mt-1 text-zinc-500">Walk to the kiosk and enter your code</p>}
          {status === 'printing' && <p className="mt-1 text-emerald-400">🖨️ Printing in progress...</p>}
          {status === 'failed' && <p className="mt-1 text-red-400">Print failed. Please contact support.</p>}
          {status === 'expired' && <p className="mt-1 text-red-400">Session expired.</p>}
        </div>
      </main>
    </div>
  )
}
