'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@vaultprint/db'
import gsap from 'gsap'

interface PrintSummary {
  pages: number
  copies: number
  color_mode: string
  status: string
}

function SuccessContent() {
  const params = useParams<{ kioskId: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const jobId = searchParams.get('jobId')

  const [summary, setSummary] = useState<PrintSummary | null>(null)
  const [status, setStatus] = useState<string>('printing')
  const [countdown, setCountdown] = useState<number | null>(null)

  const checkmarkRef = useRef<HTMLDivElement>(null)
  const circleRef = useRef<SVGCircleElement>(null)
  const pathRef = useRef<SVGPathElement>(null)

  const isCompleted = status === 'completed'

  // 1. Fetch Job Info
  useEffect(() => {
    if (!jobId) return
    const supabase = createBrowserClient()

    const fetchJob = async () => {
      const { data } = await supabase.from('print_jobs').select('total_pages, copies, color_mode, status').eq('id', jobId).single()
      const jobData = data as any
      if (jobData) {
        setSummary({
          pages: jobData.total_pages || 1,
          copies: jobData.copies || 1,
          color_mode: jobData.color_mode || 'bw',
          status: jobData.status,
        })
        setStatus(jobData.status)
      }
    }
    fetchJob()

    // Listen for changes
    const channel = supabase.channel(`job-${jobId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'print_jobs', filter: `id=eq.${jobId}` }, (payload) => {
        const newStatus = (payload.new as any).status
        setStatus(newStatus)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [jobId])

  // 2. GSAP Animation & Countdown Trigger
  useEffect(() => {
    if (isCompleted && countdown === null) {
      setCountdown(5)

      // Run GSAP animation
      const tl = gsap.timeline()
      
      // Circle draw
      if (circleRef.current) {
         tl.fromTo(circleRef.current, { strokeDasharray: 200, strokeDashoffset: 200 }, { strokeDashoffset: 0, duration: 0.6, ease: 'power2.out' })
      }
      // Checkmark draw
      if (pathRef.current) {
         tl.fromTo(pathRef.current, { strokeDasharray: 100, strokeDashoffset: 100 }, { strokeDashoffset: 0, duration: 0.4, ease: 'power2.out' }, '-=0.2')
      }
      // Bounce scale
      if (checkmarkRef.current) {
         tl.to(checkmarkRef.current, { scale: 1.1, duration: 0.2, yoyo: true, repeat: 1 }, '-=0.2')
      }
    }
  }, [isCompleted, countdown])

  // 3. Handle Countdown
  useEffect(() => {
    if (countdown === null) return

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
        
        {/* Glow behind the status */}
        <div className={`absolute inset-0 rounded-3xl lg:rounded-[2.5rem] transition-colors duration-700 blur-3xl opacity-20 ${isCompleted ? 'bg-emerald-500' : 'bg-teal-400'}`} />

        <div className="rounded-xl bg-white/5 border border-white/10 p-8 flex flex-col items-center justify-center w-full h-full text-center gap-6 shadow-inner relative z-10">
          
          <div ref={checkmarkRef} className="relative h-24 w-24 flex items-center justify-center">
            {isCompleted ? (
              <svg className="h-20 w-20 text-emerald-400" viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth="3">
                <circle ref={circleRef} cx="26" cy="26" r="24" stroke="currentColor" />
                <path ref={pathRef} strokeLinecap="round" strokeLinejoin="round" d="M16 26l7 7 15-15" />
              </svg>
            ) : (
              // Printing spinner
              <div className="relative flex items-center justify-center h-20 w-20">
                 <div className="absolute inset-0 rounded-full border-[3px] border-white/10" />
                 <div className="absolute inset-0 rounded-full border-[3px] border-t-teal-400 animate-spin" />
                 {/* Internal document icon */}
                 <svg className="w-8 h-8 text-teal-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                 </svg>
              </div>
            )}
          </div>
          
          <div>
            <h3 className="text-xl lg:text-2xl font-bold text-white mb-2 tracking-wide transition-all">
              {isCompleted ? 'Print Complete' : 'Printing Document'}
            </h3>
            <p className="text-sm text-zinc-400 leading-relaxed max-w-[250px]">
              {isCompleted ? 'Collect your document from the tray below.' : 'Please wait while your document is being printed.'}
            </p>
          </div>

          {/* Print Summary */}
          {summary && (
            <div className="mt-2 flex flex-col gap-2 w-full max-w-[280px]">
              <div className="flex justify-between items-center text-xs text-zinc-400 border-b border-white/5 pb-2">
                <span className="uppercase tracking-wider">Pages</span>
                <span className="font-semibold text-white">{summary.pages}</span>
              </div>
              <div className="flex justify-between items-center text-xs text-zinc-400 border-b border-white/5 pb-2">
                <span className="uppercase tracking-wider">Color Mode</span>
                <span className="font-semibold text-white">{summary.color_mode === 'colour' ? 'Color' : 'B&W'}</span>
              </div>
              <div className="flex justify-between items-center text-xs text-zinc-400">
                <span className="uppercase tracking-wider">Copies</span>
                <span className="font-semibold text-white">{summary.copies}</span>
              </div>
            </div>
          )}
          
        </div>
      </div>

      <div className="mt-6 lg:mt-8 flex flex-col items-center text-center transition-opacity duration-500 delay-200">
        <div className={`flex items-center gap-2 text-zinc-300 text-sm lg:text-base bg-black/30 border rounded-full px-5 lg:px-6 py-2.5 lg:py-3 shadow-inner backdrop-blur-md transition-colors ${isCompleted ? 'border-emerald-500/30' : 'border-teal-500/30'}`}>
          <div className={`h-2 w-2 lg:h-2.5 lg:w-2.5 rounded-full animate-pulse ${isCompleted ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.8)]'}`} />
          <span className={`tracking-wide ${isCompleted ? 'text-emerald-300' : 'text-teal-300'}`}>
            {countdown !== null ? `Returning home in ${countdown}...` : 'Processing Job'}
          </span>
        </div>
      </div>
    </>
  )
}

export default function KioskSuccessPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SuccessContent />
    </Suspense>
  )
}
