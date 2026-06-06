'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

// ---------------------------------------------------------------------------
// /payment/[sessionId] — Payment Page
// Shows order summary, opens Razorpay checkout modal on click.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    Razorpay: any
  }
}

export default function PaymentPage() {
  const params = useParams<{ sessionId: string }>()
  const router = useRouter()
  const sessionId = params.sessionId

  const [job, setJob] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load Razorpay script
  useEffect(() => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    document.body.appendChild(script)
    return () => { document.body.removeChild(script) }
  }, [])

  // Fetch job details via settings endpoint (to get price)
  useEffect(() => {
    async function load() {
      try {
        // Just do a no-op PATCH to get current price
        const res = await fetch(`/api/jobs/${sessionId}/settings`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        if (res.ok) {
          const data = await res.json()
          setJob(data)
        }
      } catch {}
      setLoading(false)
    }
    load()
  }, [sessionId])

  async function handlePay() {
    setPaying(true)
    setError(null)

    try {
      // 1. Create order
      const orderRes = await fetch(`/api/jobs/${sessionId}/payment/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!orderRes.ok) {
        const data = await orderRes.json()
        throw new Error(data.error || 'Failed to create order')
      }

      const { razorpay_order_id, amount, currency, key_id } = await orderRes.json()

      // 2. Open Razorpay checkout
      const options = {
        key: key_id,
        amount,
        currency,
        name: 'VaultPrint',
        description: 'Document Printing',
        order_id: razorpay_order_id,
        handler: async function (response: any) {
          // 3. Verify payment
          try {
            const verifyRes = await fetch(`/api/jobs/${sessionId}/payment/verify`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            })

            if (!verifyRes.ok) {
              const data = await verifyRes.json()
              throw new Error(data.error || 'Verification failed')
            }

            const { otp, expires_at } = await verifyRes.json()
            // Store OTP in sessionStorage for the OTP page
            sessionStorage.setItem(`vp_otp_${sessionId}`, JSON.stringify({ otp, expires_at }))
            router.push(`/otp/${sessionId}`)
          } catch (err: any) {
            setError(err.message)
            setPaying(false)
          }
        },
        modal: {
          ondismiss: () => setPaying(false),
        },
        theme: { color: '#10b981' },
      }

      const rzp = new window.Razorpay(options)
      rzp.open()
    } catch (err: any) {
      setError(err.message)
      setPaying(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Loading...
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/80 p-4">
        <h1 className="text-lg font-bold">VaultPrint</h1>
        <p className="text-sm text-zinc-400">Payment</p>
      </header>

      <main className="flex flex-1 flex-col p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Order Summary */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="mb-4 text-lg font-bold">Order Summary</h2>
          {job && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-400">Pages</span>
                <span>{job.billable_pages}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Price per page</span>
                <span>₹{job.price_per_page}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Settings</span>
                <span>{job.settings?.color_mode === 'colour' ? 'Colour' : 'B&W'} · {job.settings?.duplex ? 'Duplex' : 'Single'} · {job.settings?.copies}x</span>
              </div>
              <hr className="border-zinc-700" />
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span className="text-emerald-400">₹{job.total_price}</span>
              </div>
            </div>
          )}
        </div>

        {/* Pay Button */}
        <div className="mt-auto pt-8">
          <button
            onClick={handlePay}
            disabled={paying || !job}
            className="w-full rounded-lg bg-emerald-600 py-3.5 font-bold text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {paying ? 'Processing...' : `Pay ₹${job?.total_price || '...'}`}
          </button>
        </div>
      </main>
    </div>
  )
}
