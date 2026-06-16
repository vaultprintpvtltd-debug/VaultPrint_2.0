'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import gsap from 'gsap'

export default function KioskErrorPage() {
  const params = useParams<{ kioskId: string }>()
  const router = useRouter()

  const [countdown, setCountdown] = useState(10)

  const iconContainerRef = useRef<HTMLDivElement>(null)
  const circleRef = useRef<SVGCircleElement>(null)
  const line1Ref = useRef<SVGLineElement>(null)
  const line2Ref = useRef<SVGLineElement>(null)

  // 1. GSAP Animation on Mount
  useEffect(() => {
    const tl = gsap.timeline()
    
    // Circle draw
    if (circleRef.current) {
       tl.fromTo(circleRef.current, { strokeDasharray: 200, strokeDashoffset: 200 }, { strokeDashoffset: 0, duration: 0.6, ease: 'power2.out' })
    }
    // Cross lines draw
    if (line1Ref.current && line2Ref.current) {
       tl.fromTo(line1Ref.current, { strokeDasharray: 50, strokeDashoffset: 50 }, { strokeDashoffset: 0, duration: 0.3, ease: 'power2.out' }, '-=0.2')
       tl.fromTo(line2Ref.current, { strokeDasharray: 50, strokeDashoffset: 50 }, { strokeDashoffset: 0, duration: 0.3, ease: 'power2.out' }, '-=0.15')
    }
    // Shake effect
    if (iconContainerRef.current) {
       tl.to(iconContainerRef.current, { x: -10, duration: 0.05, yoyo: true, repeat: 5 }, '+=0.1')
    }
  }, [])

  // 2. Handle Countdown
  useEffect(() => {
    if (countdown === 0) {
       router.push(`/kiosk/${params.kioskId}`)
       return
    }

    const timer = setTimeout(() => {
      setCountdown(countdown - 1)
    }, 1000)

    return () => clearTimeout(timer)
  }, [countdown, params.kioskId, router])

  return (
    <>
      <div className="rounded-3xl lg:rounded-[2.5rem] border border-white/10 bg-[#3a4354]/90 p-6 lg:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-2xl w-full max-w-[400px] lg:max-w-none mx-auto flex flex-col items-center justify-center transition-all duration-500 scale-100 opacity-100 aspect-square relative overflow-hidden">
        
        {/* Glow behind the error state */}
        <div className="absolute inset-0 rounded-3xl lg:rounded-[2.5rem] bg-rose-500 blur-3xl opacity-20" />

        <div className="rounded-xl bg-white/5 border border-white/10 p-8 flex flex-col items-center justify-center w-full h-full text-center gap-6 shadow-inner relative z-10">
          
          <div ref={iconContainerRef} className="relative h-24 w-24 flex items-center justify-center">
            <svg className="h-20 w-20 text-rose-500" viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="3">
              <circle ref={circleRef} cx="26" cy="26" r="24" stroke="currentColor" />
              <line ref={line1Ref} x1="16" y1="16" x2="36" y2="36" strokeLinecap="round" />
              <line ref={line2Ref} x1="36" y1="16" x2="16" y2="36" strokeLinecap="round" />
            </svg>
          </div>
          
          <div>
            <h3 className="text-xl lg:text-2xl font-bold text-white mb-2 tracking-wide">
              Something went wrong
            </h3>
            <p className="text-sm text-zinc-400 leading-relaxed max-w-[250px]">
              Your payment will be refunded within 24 hours.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 lg:mt-8 flex flex-col items-center text-center transition-opacity duration-500 delay-200">
        <div className="flex items-center gap-2 text-zinc-300 text-sm lg:text-base bg-black/30 border border-rose-500/30 rounded-full px-5 lg:px-6 py-2.5 lg:py-3 shadow-inner backdrop-blur-md">
          <div className="h-2 w-2 lg:h-2.5 lg:w-2.5 rounded-full bg-rose-500 animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.8)]" />
          <span className="tracking-wide text-rose-300">
            Returning home in {countdown}...
          </span>
        </div>
      </div>
    </>
  )
}
