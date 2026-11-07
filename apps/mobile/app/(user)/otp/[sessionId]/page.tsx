'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'

// ---------------------------------------------------------------------------
// /otp/[sessionId] — the customer's print code + live job progress.
//
// The code comes from local/session storage (written by the payment page).
// If this tab doesn't have it (Android often opens a fresh tab after a UPI
// app), it asks the server to re-issue it for the paid job.
// Polls the job every 3 s: queued → printing → completed (→ /done), and
// shows the automatic refund when the job ends without a print.
// ---------------------------------------------------------------------------

interface StatusResponse {
  status: string
  error_message?: string | null
  total_price?: number | string | null
  refund_status?: string | null
  refund_amount?: number | string | null
}

function readStoredCode(sessionId: string): { otp: string; expires_at: string } | null {
  for (const store of [() => localStorage, () => sessionStorage]) {
    try {
      const raw = store().getItem(`vp_otp_${sessionId}`)
      if (raw) return JSON.parse(raw)
    } catch {}
  }
  return null
}

function saveCode(sessionId: string, otp: string, expires_at: string) {
  const value = JSON.stringify({ otp, expires_at })
  try { localStorage.setItem(`vp_otp_${sessionId}`, value) } catch {}
  try { sessionStorage.setItem(`vp_otp_${sessionId}`, value) } catch {}
}

const STEPS = [
  { key: 'paid', label: 'Code ready' },
  { key: 'queued', label: 'Released' },
  { key: 'printing', label: 'Printing' },
  { key: 'completed', label: 'Done' },
]

export default function OTPPage() {
  const params = useParams<{ sessionId: string }>()
  const router = useRouter()
  const sessionId = params.sessionId

  const [otp, setOtp] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const [job, setJob] = useState<StatusResponse | null>(null)
  const recoveringRef = useRef(false)

  // Hydrate the stored code on mount (browser-only storage)
  useEffect(() => {
    const stored = readStoredCode(sessionId)
    if (!stored) return
    /* eslint-disable react-hooks/set-state-in-effect -- hydrating browser-only storage on mount */
    setOtp(stored.otp)
    setExpiresAt(stored.expires_at)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [sessionId])

  // No code in this tab but the job is paid → get it re-issued
  const recover = useCallback(async () => {
    if (recoveringRef.current) return
    recoveringRef.current = true
    try {
      const res = await fetch(`/api/jobs/${sessionId}/payment/recover`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        if (data.otp) {
          saveCode(sessionId, data.otp, data.expires_at)
          setOtp(data.otp)
          setExpiresAt(data.expires_at)
        }
      }
    } catch {}
    recoveringRef.current = false
  }, [sessionId])

  // Poll job status every 3 s until it reaches an end state
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const res = await fetch(`/api/jobs/${sessionId}/status`, { cache: 'no-store' })
        if (res.ok) {
          const data: StatusResponse = await res.json()
          if (stopped) return
          setJob(data)
          if (data.status === 'completed') {
            router.replace(`/done/${sessionId}`)
            return
          }
          if (data.status === 'paid' && !readStoredCode(sessionId)) recover()
          // Keep polling failed/expired jobs until the refund is recorded
          const finished =
            (data.status === 'failed' || data.status === 'expired') &&
            (data.refund_status === 'processed' || data.refund_status === 'not_auto' || data.refund_status === 'not_applicable')
          if (finished) return
        }
      } catch {}
      if (!stopped) timer = setTimeout(poll, 3000)
    }
    poll()
    return () => { stopped = true; clearTimeout(timer) }
  }, [sessionId, router, recover])

  // Countdown
  useEffect(() => {
    if (!expiresAt) return
    const tick = () => setTimeLeft(Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [expiresAt])

  async function copyOTP() {
    if (!otp) return
    try {
      await navigator.clipboard.writeText(otp)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  const status = job?.status ?? 'paid'
  const ended = status === 'failed' || status === 'expired'
  const released = ['queued', 'printing', 'completed'].includes(status)
  const stepIndex = Math.max(0, STEPS.findIndex((s) => s.key === status))
  const amount = Number(job?.refund_amount ?? job?.total_price ?? 0)
  const minutes = Math.floor((timeLeft ?? 0) / 60)
  const seconds = (timeLeft ?? 0) % 60

  return (
    <div className="flex flex-col flex-1 w-full max-w-lg mx-auto relative h-full">
      {/* Stepper — same as the earlier steps */}
      <div className="mt-2 mb-2 px-2 shrink-0">
        <div className="flex items-center justify-between relative">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-white/50 rounded-full z-0"></div>
          {['Upload', 'Settings', 'Payment', 'OTP'].map((name, i) => (
            <div key={name} className="relative z-10 flex flex-col items-center gap-2">
              <div className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold ${
                i < 3 ? 'bg-emerald-500 text-white' : 'bg-brand-blue text-white shadow-md ring-4 ring-white/50'
              }`}>
                {i < 3 ? '✓' : 4}
              </div>
              <span className={`text-[10px] sm:text-xs font-semibold ${i < 3 ? 'text-emerald-600' : 'text-navy'}`}>{name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-1 mt-6 pb-8 space-y-4">
        {ended ? (
          <RefundCard status={status} refundStatus={job?.refund_status} amount={amount} error={job?.error_message} />
        ) : (
          <div className="flex flex-col items-center bg-white/40 backdrop-blur-2xl border border-white/60 shadow-[0_8px_32px_0_rgba(31,38,135,0.05)] rounded-[2rem] p-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/30 to-transparent pointer-events-none rounded-t-[2rem]"></div>

            {released ? (
              <div className="relative z-10 flex flex-col items-center text-center py-4">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-blue/10">
                  <div className="w-8 h-8 border-4 border-brand-blue border-t-transparent rounded-full animate-spin" />
                </div>
                <h2 className="text-xl font-black text-navy">
                  {status === 'printing' ? 'Printing your document…' : 'Code accepted — starting the printer…'}
                </h2>
                <p className="mt-2 text-sm font-semibold text-zinc-500">Collect your pages from the kiosk tray.</p>
              </div>
            ) : (
              <div className="relative z-10 flex flex-col items-center w-full">
                <h2 className="text-xl font-black text-navy">Your print code</h2>
                <p className="mt-1 mb-6 text-sm font-semibold text-zinc-500">Enter this code on the kiosk screen</p>

                {otp ? (
                  <div className="flex gap-2 justify-center">
                    {otp.split('').map((digit, i) => (
                      <div key={i} className="flex h-14 w-11 sm:h-16 sm:w-12 items-center justify-center rounded-xl bg-white/80 border border-white shadow-sm text-3xl font-black tabular-nums text-navy">
                        {digit}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-3 py-4 text-sm font-semibold text-zinc-500">
                    <div className="w-5 h-5 border-2 border-brand-blue border-t-transparent rounded-full animate-spin" />
                    Getting your code…
                  </div>
                )}

                {otp && (
                  <button
                    onClick={copyOTP}
                    className="mt-5 rounded-xl bg-white/70 border border-white px-5 py-2 text-xs font-bold text-navy shadow-sm active:scale-[0.98] transition"
                  >
                    {copied ? '✓ Copied' : 'Copy code'}
                  </button>
                )}

                {timeLeft !== null && (
                  <div className="mt-6 text-center">
                    {timeLeft > 0 ? (
                      <>
                        <p className="text-[10px] uppercase font-bold tracking-widest text-zinc-400">Valid for</p>
                        <p className="text-2xl font-black tabular-nums text-brand-blue">
                          {minutes}:{seconds.toString().padStart(2, '0')}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm font-bold text-amber-700">
                        Code expired — your ₹{amount.toFixed(2)} will be refunded automatically.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Progress */}
        {!ended && (
          <div className="bg-white/40 backdrop-blur-2xl border border-white/60 rounded-3xl px-5 py-4">
            <div className="flex items-center justify-between">
              {STEPS.map((s, i) => (
                <div key={s.key} className="flex flex-col items-center gap-1.5 flex-1">
                  <div className={`h-2.5 w-2.5 rounded-full ${i <= stepIndex ? 'bg-emerald-500' : 'bg-zinc-300'} ${i === stepIndex ? 'ring-4 ring-emerald-500/20' : ''}`} />
                  <span className={`text-[10px] font-bold ${i <= stepIndex ? 'text-emerald-700' : 'text-zinc-400'}`}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[11px] font-semibold text-zinc-500 text-center px-4">
          Keep this page open. If your print doesn&apos;t come out, the full amount is refunded automatically.
        </p>
      </div>
    </div>
  )
}

function RefundCard({ status, refundStatus, amount, error }: {
  status: string
  refundStatus?: string | null
  amount: number
  error?: string | null
}) {
  const done = refundStatus === 'processed'
  const title = status === 'failed' ? 'The print could not be completed' : 'This print code has expired'
  return (
    <div className="flex flex-col items-center text-center bg-white/40 backdrop-blur-2xl border border-white/60 shadow-[0_8px_32px_0_rgba(31,38,135,0.05)] rounded-[2rem] p-6">
      <div className={`mb-4 flex h-16 w-16 items-center justify-center rounded-full ${done ? 'bg-emerald-500/15' : 'bg-amber-500/15'}`}>
        {done ? (
          <svg className="h-8 w-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <div className="w-7 h-7 border-[3px] border-amber-500 border-t-transparent rounded-full animate-spin" />
        )}
      </div>
      <h2 className="text-xl font-black text-navy">{title}</h2>
      {status === 'failed' && error && <p className="mt-1 text-xs font-semibold text-zinc-500">{error}</p>}
      {refundStatus === 'not_applicable' ? (
        <p className="mt-3 text-sm font-semibold text-zinc-600">No payment was taken for this session.</p>
      ) : refundStatus === 'not_auto' ? (
        <p className="mt-3 text-sm font-semibold text-zinc-600">Please contact the kiosk staff about a refund.</p>
      ) : done ? (
        <p className="mt-3 text-sm font-semibold text-zinc-600">
          ₹{amount.toFixed(2)} has been refunded to your original payment method. It usually reaches you within 5–7 working days.
        </p>
      ) : (
        <p className="mt-3 text-sm font-semibold text-zinc-600">
          Refunding ₹{amount.toFixed(2)} to your original payment method — this takes about a minute to start.
        </p>
      )}
    </div>
  )
}
