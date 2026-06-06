'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'

// ---------------------------------------------------------------------------
// /kiosk/[kioskId]/enter-otp — Numpad OTP Entry
// ---------------------------------------------------------------------------

export default function EnterOTPPage() {
  const params = useParams<{ kioskId: string }>()
  const router = useRouter()
  const kioskId = params.kioskId

  const [digits, setDigits] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const [loading, setLoading] = useState(false)
  const [attemptsRemaining, setAttemptsRemaining] = useState(3)
  const [sessionId, setSessionId] = useState<string | null>(null)

  // Find the queued job's session_id for this kiosk
  useEffect(() => {
    async function findJob() {
      try {
        // We need to find the queued job — query via a lightweight endpoint
        // For now, store it from the realtime navigation or query param
        const urlParams = new URLSearchParams(window.location.search)
        const sid = urlParams.get('session')
        if (sid) setSessionId(sid)
      } catch {}
    }
    findJob()
  }, [kioskId])

  const addDigit = useCallback((d: string) => {
    if (digits.length >= 6) return
    setDigits((prev) => [...prev, d])
    setError(null)
  }, [digits.length])

  const removeDigit = useCallback(() => {
    setDigits((prev) => prev.slice(0, -1))
    setError(null)
  }, [])

  const submitOTP = useCallback(async () => {
    if (digits.length !== 6 || !sessionId) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/kiosk/${kioskId}/otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          otp: digits.join(''),
        }),
      })

      const data = await res.json()

      if (data.valid) {
        router.push(`/kiosk/${kioskId}/success?session=${sessionId}`)
        return
      }

      // Wrong OTP
      setAttemptsRemaining(data.attempts_remaining)
      setShake(true)
      setTimeout(() => setShake(false), 500)
      setDigits([])

      if (data.attempts_remaining <= 0) {
        setError(data.reason === 'expired' ? 'Code expired' : 'Too many attempts. Session expired.')
      } else {
        setError(`Wrong code. ${data.attempts_remaining} attempt${data.attempts_remaining > 1 ? 's' : ''} left.`)
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [digits, sessionId, kioskId, router])

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (digits.length === 6) {
      submitOTP()
    }
  }, [digits.length, submitOTP])

  // Keyboard support
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key >= '0' && e.key <= '9') addDigit(e.key)
      else if (e.key === 'Backspace') removeDigit()
      else if (e.key === 'Enter' && digits.length === 6) submitOTP()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [addDigit, removeDigit, submitOTP, digits.length])

  const numpadKeys = ['1','2','3','4','5','6','7','8','9','','0','⌫']

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 text-zinc-100 p-8">
      <h1 className="mb-2 text-3xl font-bold">Enter Print Code</h1>
      <p className="mb-8 text-zinc-400">Type the 6-digit code from your phone</p>

      {/* Digit boxes */}
      <div className={`mb-6 flex gap-3 ${shake ? 'animate-shake' : ''}`}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={`flex h-16 w-12 items-center justify-center rounded-xl border-2 text-2xl font-bold ${
              digits[i]
                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                : 'border-zinc-700 bg-zinc-900 text-zinc-500'
            }`}
          >
            {digits[i] || '·'}
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 text-sm text-red-400">{error}</div>
      )}

      {/* Attempts warning */}
      {attemptsRemaining < 3 && attemptsRemaining > 0 && (
        <div className="mb-4 text-sm text-amber-400">
          {attemptsRemaining} attempt{attemptsRemaining > 1 ? 's' : ''} remaining
        </div>
      )}

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-3">
        {numpadKeys.map((key, i) => (
          <button
            key={i}
            onClick={() => {
              if (key === '⌫') removeDigit()
              else if (key !== '') addDigit(key)
            }}
            disabled={loading || key === '' || attemptsRemaining <= 0}
            className={`flex h-16 w-20 items-center justify-center rounded-xl text-2xl font-bold transition ${
              key === ''
                ? 'invisible'
                : key === '⌫'
                ? 'border border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
                : 'border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 active:bg-zinc-700'
            } disabled:opacity-30`}
          >
            {key}
          </button>
        ))}
      </div>

      {/* Back link */}
      {attemptsRemaining <= 0 && (
        <button
          onClick={() => router.push(`/kiosk/${kioskId}`)}
          className="mt-8 text-sm text-zinc-500 hover:text-zinc-300"
        >
          Return to home screen
        </button>
      )}

      <style jsx>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-8px); }
          40%, 80% { transform: translateX(8px); }
        }
        .animate-shake { animation: shake 0.4s ease-in-out; }
      `}</style>
    </div>
  )
}
