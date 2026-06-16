'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'

export default function KioskEnterOTPPage() {
  const router = useRouter()
  const params = useParams<{ kioskId: string }>()
  
  const [otp, setOtp] = useState<string>('')
  const [attempts, setAttempts] = useState(3)
  const [isShaking, setIsShaking] = useState(false)
  const [timeLeft, setTimeLeft] = useState(272) // 4:32

  useEffect(() => {
    if (timeLeft <= 0) {
      router.push(`/kiosk/${params.kioskId}/error`)
      return
    }
    const timer = setInterval(() => setTimeLeft(t => t - 1), 1000)
    return () => clearInterval(timer)
  }, [timeLeft, router, params.kioskId])

  const handleKeyPress = (key: string) => {
    if (key === 'del') {
      setOtp(prev => prev.slice(0, -1))
    } else if (key === 'enter') {
      if (otp.length === 6) {
        verifyOtp()
      }
    } else {
      if (otp.length < 6) {
        setOtp(prev => prev + key)
      }
    }
  }

  const verifyOtp = () => {
    // Mock validation: "000000" is success, anything else fails
    if (otp === '000000') {
      router.push(`/kiosk/${params.kioskId}/success?jobId=mock`)
    } else {
      const newAttempts = attempts - 1
      if (newAttempts <= 0) {
        router.push(`/kiosk/${params.kioskId}/error`)
      } else {
        setAttempts(newAttempts)
        setOtp('')
        triggerShake()
      }
    }
  }

  const triggerShake = () => {
    setIsShaking(true)
    setTimeout(() => setIsShaking(false), 400)
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
      
      <div className={`rounded-3xl lg:rounded-[2.5rem] border border-white/10 bg-[#3a4354]/90 p-6 lg:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-2xl w-full max-w-[400px] lg:max-w-none aspect-square mx-auto flex flex-col items-center justify-center transition-all duration-500 ${isShaking ? 'animate-shake' : ''}`}>
        
        {/* Job Context Strip */}
        <div className="w-full bg-black/30 rounded-2xl p-3 mb-3 border border-white/5 flex items-center justify-center gap-3 shadow-inner">
          <div className="h-2 w-2 rounded-full bg-teal-400 animate-pulse shadow-[0_0_8px_rgba(45,212,191,0.8)]" />
          <span className="text-zinc-300 font-medium tracking-wide text-sm">
            Ready: 12 pages · B&W · 2 copies
          </span>
        </div>

        <div className="text-center mb-3">
          <h3 className="text-lg lg:text-xl font-bold text-white mb-1 tracking-wide">Enter the 6-digit code</h3>
          <p className="text-xs lg:text-sm text-zinc-400 leading-relaxed">
            Check your mobile device for the OTP. (Hint: 000000)
          </p>
        </div>
        
        {/* OTP Input Boxes */}
        <div className="flex items-center justify-center gap-2 mb-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={`w-10 h-12 lg:w-12 lg:h-14 flex items-center justify-center rounded-xl border-2 transition-all ${
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
        <div className="h-5 mb-2 flex items-center justify-center w-full">
          {attempts < 3 && (
            <span className="text-rose-400 text-sm font-semibold tracking-wide animate-pulse bg-rose-500/10 px-4 py-1.5 rounded-full border border-rose-500/20">
              Incorrect — {attempts} {attempts === 1 ? 'attempt' : 'attempts'} remaining
            </span>
          )}
        </div>

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-2 w-full">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
            <button
              key={num}
              onClick={() => handleKeyPress(num.toString())}
              className="h-12 lg:h-14 rounded-2xl bg-white/5 border border-white/10 text-xl lg:text-2xl font-jakarta text-white font-semibold hover:bg-white/10 active:bg-white/20 active:scale-95 transition-all backdrop-blur-sm"
            >
              {num}
            </button>
          ))}
          <button
            onClick={() => handleKeyPress('del')}
            className="h-12 lg:h-14 rounded-2xl bg-white/5 border border-white/10 text-xl font-jakarta text-zinc-400 font-semibold hover:bg-white/10 active:bg-rose-500/20 active:text-rose-400 active:scale-95 transition-all backdrop-blur-sm flex items-center justify-center group"
          >
            <svg className="w-6 h-6 lg:w-7 lg:h-7 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z" />
            </svg>
          </button>
          <button
            onClick={() => handleKeyPress('0')}
            className="h-12 lg:h-14 rounded-2xl bg-white/5 border border-white/10 text-xl lg:text-2xl font-jakarta text-white font-semibold hover:bg-white/10 active:bg-white/20 active:scale-95 transition-all backdrop-blur-sm"
          >
            0
          </button>
          <button
            onClick={() => handleKeyPress('enter')}
            disabled={otp.length !== 6}
            className={`h-12 lg:h-14 rounded-2xl border text-sm font-bold uppercase tracking-widest transition-all backdrop-blur-sm flex items-center justify-center ${
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
        <span className="tracking-wide">Code expires in {formatTime(timeLeft)}</span>
      </div>
    </>
  )
}
