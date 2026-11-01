'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { kioskApi, getKioskApiKey } from '@/lib/kiosk-api'

// ---------------------------------------------------------------------------
// /kiosk/[kioskId]/enter-otp — the print release pad
//
// The customer types the 6-digit code from their phone. POST /otp matches
// it against this kiosk's paid jobs and, if correct, releases the job to
// the print agent ('paid' → 'queued'). Then → success screen for that job.
// Returns to the idle screen after 60s without input.
// ---------------------------------------------------------------------------

const IDLE_TIMEOUT_SECONDS = 60

interface OtpResponse {
  valid?: boolean
  job_id?: string
  attempts_remaining?: number
  reason?: string
}

export default function KioskEnterOTPPage() {
  const router = useRouter()
  const params = useParams<{ kioskId: string }>()
  const kioskId = params.kioskId

  const [otp, setOtp] = useState<string>('')
  const [message, setMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [isShaking, setIsShaking] = useState(false)
  const [timeLeft, setTimeLeft] = useState(IDLE_TIMEOUT_SECONDS)

  // Any key press resets the inactivity countdown
  useEffect(() => {
    if (timeLeft <= 0) {
      router.push(`/kiosk/${kioskId}`)
      return
    }
    const timer = setTimeout(() => setTimeLeft(t => t - 1), 1000)
    return () => clearTimeout(timer)
  }, [timeLeft, router, kioskId])

  const triggerShake = () => {
    setIsShaking(true)
    setTimeout(() => setIsShaking(false), 400)
  }

  const verifyOtp = useCallback(async (code: string) => {
    if (submitting) return
    if (!getKioskApiKey()) {
      setMessage('Kiosk not provisioned — staff: open this screen once with ?key=')
      return
    }

    setSubmitting(true)
    setMessage(null)
    try {
      const { ok, data } = await kioskApi<OtpResponse>(kioskId, '/otp', { otp: code })

      if (ok && data.valid && data.job_id) {
        router.push(`/kiosk/${kioskId}/success?jobId=${data.job_id}`)
        return
      }

      setOtp('')
      triggerShake()
      if (data.reason === 'paper_out') {
        setMessage('The printer is out of paper. Your code has NOT been used — please call staff to refill it.')
      } else if (data.reason === 'printer_not_ready') {
        setMessage('The printer is not ready. Your code has NOT been used — please try again shortly or contact staff.')
      } else if (data.reason === 'printer_offline') {
        setMessage('The printer is offline right now. Your code has NOT been used — please try again shortly or contact staff.')
      } else if (data.reason === 'locked') {
        setMessage('Too many incorrect codes. Please wait a few minutes.')
      } else if (data.reason === 'expired' || data.reason === 'max_attempts') {
        setMessage('This code has expired. Please contact staff for help.')
      } else if (data.reason === 'wrong') {
        setMessage('Incorrect code — please check your phone and try again.')
      } else {
        setMessage(data.error || 'Could not verify the code. Please try again.')
      }
    } catch {
      setOtp('')
      setMessage('Network problem — please try again.')
    } finally {
      setSubmitting(false)
    }
  }, [kioskId, router, submitting])

  const handleKeyPress = (key: string) => {
    setTimeLeft(IDLE_TIMEOUT_SECONDS)
    if (submitting) return
    if (key === 'del') {
      setOtp(prev => prev.slice(0, -1))
    } else if (key === 'enter') {
      if (otp.length === 6) verifyOtp(otp)
    } else if (otp.length < 6) {
      const next = otp + key
      setOtp(next)
      // Auto-submit on the sixth digit
      if (next.length === 6) verifyOtp(next)
    }
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <>
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-8px); }
          40%, 80% { transform: translateX(8px); }
        }
        .animate-shake {
          animation: shake 0.4s cubic-bezier(.36,.07,.19,.97) both;
        }
      `}</style>
      
      <div className={`rounded-3xl lg:rounded-[2.5rem] border border-white/10 bg-[#3a4354]/90 p-[3vh] shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-2xl min-h-0 flex-1 w-full max-w-[440px] mx-auto flex flex-col items-center transition-all duration-500 ${isShaking ? 'animate-shake' : ''}`}>
        
        {/* Job Context Strip */}
        <div className="w-full shrink-0 bg-black/30 rounded-2xl px-3 py-[1.2vh] mb-[1.2vh] border [@media(max-height:660px)]:hidden border-white/5 flex items-center justify-center gap-3 shadow-inner">
          <div className="h-2 w-2 rounded-full bg-teal-400 animate-pulse shadow-[0_0_8px_rgba(45,212,191,0.8)]" />
          <span className="text-zinc-300 font-medium tracking-wide text-sm">
            {submitting ? 'Checking your code…' : 'Paid on your phone? Release your print here'}
          </span>
        </div>

        <div className="text-center shrink-0 mb-[1.2vh]">
          <h3 className="text-lg lg:text-xl font-bold text-white mb-1 tracking-wide">Enter the 6-digit code</h3>
          <p className="text-xs lg:text-sm text-zinc-400 leading-relaxed [@media(max-height:660px)]:hidden">
            The code is shown on your phone after payment.
          </p>
        </div>
        
        {/* OTP Input Boxes */}
        <div className="flex shrink-0 items-center justify-center gap-2 mb-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={`w-[clamp(32px,6vh,48px)] h-[clamp(36px,7vh,56px)] flex items-center justify-center rounded-xl border-2 transition-all ${
                i < otp.length 
                  ? 'border-teal-400 bg-teal-400/10 text-white shadow-[0_0_10px_rgba(45,212,191,0.2)]' 
                  : 'border-white/10 bg-black/40 text-transparent'
              }`}
            >
              {i < otp.length && (
                <span className="text-2xl font-jakarta font-bold">{otp[i]}</span>
              )}
            </div>
          ))}
        </div>

        {/* Warning Message */}
        <div className="min-h-5 shrink-0 mb-[1vh] flex items-center justify-center w-full">
          {message && (
            <span className="text-rose-300 text-sm font-semibold tracking-wide text-center bg-rose-500/10 px-4 py-1.5 rounded-2xl border border-rose-500/20">
              {message}
            </span>
          )}
        </div>

        {/* Numpad */}
        <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-4 gap-[1vh] w-full">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
            <button
              key={num}
              onClick={() => handleKeyPress(num.toString())}
              className="h-full min-h-0 rounded-2xl bg-white/5 border border-white/10 text-xl lg:text-2xl font-jakarta text-white font-semibold hover:bg-white/10 active:bg-white/20 active:scale-95 transition-all backdrop-blur-sm"
            >
              {num}
            </button>
          ))}
          <button
            onClick={() => handleKeyPress('del')}
            className="h-full min-h-0 rounded-2xl bg-white/5 border border-white/10 text-xl font-jakarta text-zinc-400 font-semibold hover:bg-white/10 active:bg-rose-500/20 active:text-rose-400 active:scale-95 transition-all backdrop-blur-sm flex items-center justify-center group"
          >
            <svg className="w-6 h-6 lg:w-7 lg:h-7 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z" />
            </svg>
          </button>
          <button
            onClick={() => handleKeyPress('0')}
            className="h-full min-h-0 rounded-2xl bg-white/5 border border-white/10 text-xl lg:text-2xl font-jakarta text-white font-semibold hover:bg-white/10 active:bg-white/20 active:scale-95 transition-all backdrop-blur-sm"
          >
            0
          </button>
          <button
            onClick={() => handleKeyPress('enter')}
            disabled={otp.length !== 6 || submitting}
            className={`h-full min-h-0 rounded-2xl border text-sm font-bold uppercase tracking-widest transition-all backdrop-blur-sm flex items-center justify-center ${
              otp.length === 6
                ? 'bg-emerald-500 hover:bg-emerald-400 border-emerald-400 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)] active:scale-95'
                : 'bg-white/5 border-white/10 text-zinc-600 cursor-not-allowed'
            }`}
          >
            Confirm
          </button>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-2 text-zinc-400 text-sm bg-black/40 px-4 py-2 rounded-full border border-white/5 backdrop-blur-md">
        <svg className="w-4 h-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="tracking-wide">Returning to start in {formatTime(timeLeft)}</span>
      </div>
    </>
  )
}
