'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'

// ---------------------------------------------------------------------------
// /payment/[sessionId] — Payment Page
//
// Android: paying in a UPI app often reloads this page or drops Razorpay's
// success callback. So the page never relies on the callback alone — on
// load, on return to the tab, and on modal close it asks the server, which
// checks with Razorpay and (re-)issues the code. An already-paid session is
// never offered "Pay" again.
// ---------------------------------------------------------------------------

interface RazorpayInstance {
  open: () => void
  on?: (event: string, cb: (response: unknown) => void) => void
}
interface RazorpayConstructor {
  new (options: Record<string, unknown>): RazorpayInstance
}
declare global {
  interface Window {
    Razorpay: RazorpayConstructor
  }
}

interface JobDetails {
  status: string
  file_name: string | null
  total_pages: number | null
  color_mode: string
  copies: number
  orientation: string
  quality: string | null
  price_per_page: number
  billable_pages: number
  total_price: number
}

interface Order {
  razorpay_order_id: string
  amount: number
  currency: string
  key_id: string
}

// Order-route codes meaning "can't pay right now" — no point retrying at once
const BLOCKING_CODES = ['printer_offline', 'paper_out', 'printer_not_ready', 'expired', 'not_customized']

/** Persist the code where any tab of this browser can find it again. */
function saveCode(sessionId: string, otp: string, expires_at: string) {
  const value = JSON.stringify({ otp, expires_at })
  try { localStorage.setItem(`vp_otp_${sessionId}`, value) } catch {}
  try { sessionStorage.setItem(`vp_otp_${sessionId}`, value) } catch {}
}

export default function PaymentPage() {
  const params = useParams<{ sessionId: string }>()
  const router = useRouter()
  const sessionId = params.sessionId

  const [job, setJob] = useState<JobDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const orderRef = useRef<Order | null>(null)
  const leavingRef = useRef(false)

  // Ask the server (which asks Razorpay) for the code. Works without
  // Razorpay's browser callback, and re-issues the code for a paid job.
  const recoverCode = useCallback(async (): Promise<boolean> => {
    if (leavingRef.current) return true
    try {
      const res = await fetch(`/api/jobs/${sessionId}/payment/recover`, { method: 'POST' })
      if (!res.ok) return false
      const data = await res.json()
      if (!data.otp) return false
      saveCode(sessionId, data.otp, data.expires_at)
      leavingRef.current = true
      router.replace(`/otp/${sessionId}`)
      return true
    } catch {
      return false
    }
  }, [sessionId, router])

  /** Create (or reuse) the Razorpay order. Never throws. */
  const prepareOrder = useCallback(async (): Promise<Order | null> => {
    if (orderRef.current) return orderRef.current
    try {
      const res = await fetch(`/api/jobs/${sessionId}/payment/order`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        orderRef.current = data as Order
        setError(null)
        setBlocked(false)
        return orderRef.current
      }
      if (data.code === 'already_paid') {
        if (!(await recoverCode())) {
          leavingRef.current = true
          router.replace(`/otp/${sessionId}`)
        }
        return null
      }
      setError(data.error || 'Could not start the payment. Please try again.')
      setBlocked(BLOCKING_CODES.includes(data.code))
      return null
    } catch {
      setError('Network problem — please check your connection and try again.')
      return null
    }
  }, [sessionId, recoverCode, router])

  // Load Razorpay's checkout script once
  useEffect(() => {
    if (window.Razorpay || document.querySelector('script[data-rzp]')) return
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.dataset.rzp = '1'
    document.body.appendChild(script)
  }, [])

  // Load the job. Paid / finished sessions go to the right screen; otherwise
  // the order is created in the background so "Pay" opens instantly.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/jobs/${sessionId}/status`)
        if (!res.ok) {
          if (!cancelled) setError('Could not load this print session. Please scan the kiosk QR code again.')
          return
        }
        const data: JobDetails = await res.json()
        if (cancelled) return
        setJob(data)

        if (data.status === 'paid') {
          if (!(await recoverCode())) router.replace(`/otp/${sessionId}`)
          return
        }
        if (['queued', 'printing', 'failed'].includes(data.status)) {
          router.replace(`/otp/${sessionId}`)
          return
        }
        if (data.status === 'completed') {
          router.replace(`/done/${sessionId}`)
          return
        }
        // Returning from a UPI app / reopened page: maybe already paid
        if (data.status === 'payment_pending' && (await recoverCode())) return
        await prepareOrder()
      } catch {
        if (!cancelled) setError('Network problem — please check your connection and try again.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [sessionId, recoverCode, prepareOrder, router])

  // Kiosk offline / out of paper: re-check every 10 s, so "Pay" comes back
  // by itself as soon as staff fix the printer
  useEffect(() => {
    if (!blocked) return
    const timer = setInterval(() => { prepareOrder() }, 10000)
    return () => clearInterval(timer)
  }, [blocked, prepareOrder])

  // Back from a UPI app (tab visible again / page restored)? Check payment.
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'visible' && orderRef.current) recoverCode()
    }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('pageshow', check)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('pageshow', check)
    }
  }, [recoverCode])

  async function handlePay() {
    setPaying(true)
    setError(null)

    const order = await prepareOrder()
    if (!order) { setPaying(false); return }
    if (!window.Razorpay) {
      setError('The payment window is still loading — please tap Pay again in a moment.')
      setPaying(false)
      return
    }

    const rzp = new window.Razorpay({
      key: order.key_id,
      amount: order.amount,
      currency: order.currency,
      name: 'VaultPrint',
      description: 'Document Printing',
      order_id: order.razorpay_order_id,
      // Don't ask for phone / email. Razorpay honours this once "optional
      // contact details" is enabled on the account.
      hidden: { contact: true, email: true },
      readonly: { contact: true, email: true },
      handler: async function (response: {
        razorpay_order_id: string
        razorpay_payment_id: string
        razorpay_signature: string
      }) {
        try {
          const verifyRes = await fetch(`/api/jobs/${sessionId}/payment/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(response),
          })
          if (!verifyRes.ok) throw new Error('Verification failed')
          const { otp, expires_at } = await verifyRes.json()
          saveCode(sessionId, otp, expires_at)
          leavingRef.current = true
          router.replace(`/otp/${sessionId}`)
        } catch {
          // The callback's request failed — ask Razorpay directly
          if (await recoverCode()) return
          setError('We could not confirm your payment yet. If money was deducted, stay on this page — your code will appear, or the amount is refunded automatically.')
          setPaying(false)
        }
      },
      modal: {
        // Closed after paying in a UPI app? Check before giving up
        ondismiss: async () => {
          if (!(await recoverCode())) setPaying(false)
        },
      },
      theme: { color: '#3B5BDB' },
    })
    rzp.on?.('payment.failed', () => {
      setError('The payment did not go through and no money was taken. Please try again.')
      setPaying(false)
    })
    rzp.open()
  }

  const steps = [
    { id: 1, name: 'Upload', active: false },
    { id: 2, name: 'Settings', active: false },
    { id: 3, name: 'Payment', active: true },
    { id: 4, name: 'OTP', active: false },
  ]

  if (loading) {
    return (
      <div className="flex flex-1 w-full max-w-lg mx-auto items-center justify-center relative h-full">
        <div className="w-8 h-8 border-4 border-brand-blue border-t-transparent rounded-full animate-spin"></div>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 w-full max-w-lg mx-auto relative h-full">

      {/* Mobile Stepper */}
      <div className="mt-2 mb-2 px-2 shrink-0">
        <div className="flex items-center justify-between relative">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-white/50 rounded-full z-0"></div>
          {steps.map((step) => (
            <div key={step.id} className="relative z-10 flex flex-col items-center gap-2">
              <div className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold transition-colors ${
                step.active
                  ? 'bg-brand-blue text-white shadow-md ring-4 ring-white/50'
                  : step.id < 3
                    ? 'bg-emerald-500 text-white'
                    : 'bg-white text-zinc-400 border border-zinc-200'
              }`}>
                {step.id < 3 ? '✓' : step.id}
              </div>
              <span className={`text-[10px] sm:text-xs font-semibold ${step.active ? 'text-navy' : step.id < 3 ? 'text-emerald-600' : 'text-zinc-400'}`}>
                {step.name}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto pb-32 no-scrollbar px-1 mt-6">

        {error && (
          <div className={`mb-6 rounded-2xl border px-4 py-4 shadow-sm flex flex-col gap-3 backdrop-blur-md ${
            blocked ? 'border-amber-500/20 bg-amber-50/80' : 'border-red-500/20 bg-red-50/80'
          }`}>
            <span className={`text-sm font-bold ${blocked ? 'text-amber-700' : 'text-red-600'}`}>{error}</span>
            {!blocked && (
              <button
                onClick={handlePay}
                className="bg-red-100 text-red-700 py-2 rounded-xl text-xs font-bold hover:bg-red-200 transition-colors"
              >
                Try again
              </button>
            )}
          </div>
        )}

        {/* Order Summary Glass Card */}
        {job && (
          <div className="flex flex-col bg-white/40 backdrop-blur-2xl border border-white/60 shadow-[0_8px_32px_0_rgba(31,38,135,0.05)] rounded-[2rem] p-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/30 to-transparent pointer-events-none rounded-t-[2rem]"></div>

            <h2 className="text-xl font-black text-navy mb-6 relative z-10">Order Summary</h2>

            <div className="space-y-4 relative z-10">
              <div className="flex items-start justify-between pb-4 border-b border-white/40">
                <span className="text-sm font-semibold text-zinc-500">Document</span>
                <span className="text-sm font-bold text-navy max-w-[180px] text-right truncate">
                  {job.file_name || 'document.pdf'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-y-4 gap-x-2 pb-4 border-b border-white/40">
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-bold text-zinc-400">Pages</span>
                  <span className="text-sm font-bold text-navy">{job.total_pages || '-'}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-bold text-zinc-400">Colour</span>
                  <span className="text-sm font-bold text-navy capitalize">{job.color_mode === 'bw' ? 'Black & White' : 'Colour'}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-bold text-zinc-400">Copies</span>
                  <span className="text-sm font-bold text-navy">{job.copies}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-bold text-zinc-400">Orientation</span>
                  <span className="text-sm font-bold text-navy capitalize">{job.orientation}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-bold text-zinc-400">Quality</span>
                  <span className="text-sm font-bold text-navy capitalize">{job.quality || 'Standard'}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-bold text-zinc-400">Paper Size</span>
                  <span className="text-sm font-bold text-navy">A4</span>
                </div>
              </div>

              {/* Pricing Breakdown */}
              <div className="pt-2">
                <div className="bg-white/50 rounded-xl p-4 border border-white/60 shadow-inner">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-zinc-500">Price Breakdown</span>
                    <span className="text-xs font-bold text-navy">
                      ₹{job.price_per_page} × {job.billable_pages / job.copies} pgs × {job.copies} cp
                    </span>
                  </div>
                  <div className="flex items-end justify-between mt-4">
                    <span className="text-sm font-bold text-zinc-400 uppercase tracking-widest">Total</span>
                    <span className="text-4xl font-black text-brand-blue">
                      ₹{Number(job.total_price)?.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-[11px] font-semibold text-zinc-500 text-center pt-1">
                If your print doesn&apos;t come out, the full amount is refunded automatically.
              </p>
            </div>
          </div>
        )}

      </div>

      {/* Sticky Bottom Pay Strip */}
      <div className="absolute bottom-0 left-0 w-full p-4 z-50">
        <div className="bg-white/70 backdrop-blur-2xl border border-white/60 shadow-[0_-8px_30px_0_rgba(31,38,135,0.1)] rounded-3xl p-4 flex flex-col relative overflow-hidden">
           <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/40 to-transparent pointer-events-none rounded-t-3xl"></div>

           <div className="flex flex-col relative z-10">
             <button
                onClick={handlePay}
                disabled={paying || !job || blocked}
                className="w-full bg-navy text-white font-black text-lg py-4 rounded-2xl shadow-xl shadow-navy/20 hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 transition-all flex items-center justify-center gap-2"
              >
                {paying ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    Pay ₹{Number(job?.total_price ?? 0).toFixed(2)}
                  </>
                )}
              </button>

              <div className="flex items-center justify-center gap-2 mt-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                <span>Powered by Razorpay</span>
                <span className="w-1 h-1 rounded-full bg-zinc-300"></span>
                <span>UPI</span>
                <span className="w-1 h-1 rounded-full bg-zinc-300"></span>
                <span>Cards</span>
                <span className="w-1 h-1 rounded-full bg-zinc-300"></span>
                <span>Wallets</span>
              </div>
           </div>
        </div>
      </div>

    </div>
  )
}
