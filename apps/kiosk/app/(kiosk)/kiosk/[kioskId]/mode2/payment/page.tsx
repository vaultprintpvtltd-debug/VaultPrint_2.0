'use client'

import { Suspense, useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@vaultprint/db'
import { useKioskConfig } from '@/hooks/use-kiosk-config'
import { getSchoolOfflineMode } from '@vaultprint/lib/kiosk-config'
import { kioskApi } from '@/lib/kiosk-api'

// ---------------------------------------------------------------------------
// /kiosk/[kioskId]/mode2/payment — POS payment screen (PRD C2.4, C2.8)
//
// Shows the server-computed total. With require_receipt_ref (Option A,
// launch default) the "Payment Done" button stays disabled until the
// student enters the last digits of the POS merchant slip.
// pos-confirm is atomic and idempotent — a double-tap gets a 409 and
// changes nothing.
// ---------------------------------------------------------------------------

function Mode2PaymentInner() {
  const params = useParams<{ kioskId: string }>()
  const search = useSearchParams()
  const router = useRouter()
  const kioskId = params.kioskId
  const jobId = search.get('jobId')

  const { config } = useKioskConfig(kioskId)
  const school = config ? getSchoolOfflineMode(config) : undefined
  const requireRef = school?.payment.require_receipt_ref ?? true

  const [totalPrice, setTotalPrice] = useState<string | null>(null)
  const [receiptRef, setReceiptRef] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Server-computed total (anon read) ──────────────────────────────────
  useEffect(() => {
    if (!jobId) return

    async function load() {
      const supabase = createBrowserClient()
      // Explicit cast: supabase-js result inference degrades to `never`
      // inside nested closures with this TS version.
      const { data } = (await supabase
        .from('print_jobs')
        .select('total_price, status')
        .eq('id', jobId!)
        .eq('kiosk_id', kioskId)
        .single()) as { data: { total_price: number | null; status: string } | null }

      if (data?.total_price != null) setTotalPrice(Number(data.total_price).toFixed(2))
    }

    load()
  }, [jobId, kioskId])

  // ── Session timeout → auto-cancel ──────────────────────────────────────
  useEffect(() => {
    if (!school || !jobId || confirmed) return
    const t = setTimeout(async () => {
      await kioskApi(kioskId, '/mode2/cancel', { job_id: jobId })
      router.push(`/kiosk/${kioskId}`)
    }, school.session_timeout_minutes * 60 * 1000)
    return () => clearTimeout(t)
  }, [school, jobId, kioskId, router, confirmed])

  async function handlePaymentDone() {
    if (!jobId || submitting || confirmed) return
    setSubmitting(true)
    setError(null)

    const { ok, status, data } = await kioskApi<{ otp?: string }>(
      kioskId,
      '/pos-confirm',
      {
        job_id: jobId,
        ...(requireRef ? { receipt_ref: receiptRef } : {}),
        ...(totalPrice !== null ? { client_amount: Number(totalPrice) } : {}),
      }
    )

    if (!ok) {
      setError(
        status === 409
          ? 'This payment was already confirmed or the session expired.'
          : data.error || 'Could not confirm payment.'
      )
      setSubmitting(false)
      return
    }

    setConfirmed(true)

    if (school?.otp_display === 'show' && data.otp) {
      router.push(
        `/kiosk/${kioskId}/mode2/otp?jobId=${jobId}&otp=${encodeURIComponent(data.otp)}`
      )
      return
    }

    // Default (otp_display: "skip") — straight to printing/success
    setTimeout(() => {
      router.push(`/kiosk/${kioskId}/success?jobId=${jobId}`)
    }, 2500)
  }

  async function handleCancel() {
    if (confirmed) return
    await kioskApi(kioskId, '/mode2/cancel', { job_id: jobId })
    router.push(`/kiosk/${kioskId}`)
  }

  if (!jobId) {
    router.push(`/kiosk/${kioskId}`)
    return null
  }

  const refValid = !requireRef || /^\d{4,10}$/.test(receiptRef)

  if (confirmed && school?.otp_display !== 'show') {
    return (
      <div className="flex w-full max-w-[440px] flex-col items-center gap-5 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-teal-400/10 border border-teal-400/40 shadow-[0_0_25px_rgba(45,212,191,0.35)]">
          <svg className="h-10 w-10 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-white">Payment confirmed</h2>
        <p className="text-zinc-400">Printing your document…</p>
      </div>
    )
  }

  return (
    <div className="flex w-full max-w-[440px] flex-col gap-5">
      <div className="text-center">
        <h2 className="text-xl lg:text-2xl font-bold text-white tracking-wide">Pay at the card machine</h2>
        <p className="mt-1 text-sm text-zinc-400">Tap or insert your card on the POS terminal next to this screen</p>
      </div>

      {/* Amount */}
      <div className="rounded-3xl border border-teal-400/20 bg-[#163b3e]/70 px-6 py-8 text-center shadow-inner">
        <p className="text-xs uppercase tracking-widest text-zinc-400">Amount to pay</p>
        <p className="mt-2 font-jakarta text-5xl font-extrabold text-teal-400">
          {totalPrice !== null ? `₹${totalPrice}` : '—'}
        </p>
      </div>

      {/* Receipt ref gate (Option A — manual confirm) */}
      {requireRef && (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
          <label htmlFor="receipt-ref" className="mb-2 block text-sm font-medium text-zinc-300">
            Enter the last 6 digits of your POS receipt number
          </label>
          <input
            id="receipt-ref"
            inputMode="numeric"
            pattern="\d*"
            maxLength={10}
            value={receiptRef}
            onChange={(e) => setReceiptRef(e.target.value.replace(/\D/g, ''))}
            placeholder="e.g. 482913"
            className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3.5 text-center font-jakarta text-2xl font-bold tracking-[0.3em] text-white placeholder-zinc-600 outline-none transition focus:border-teal-400"
          />
        </div>
      )}

      {error && (
        <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-center text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleCancel}
          className="rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-sm text-zinc-300 transition hover:bg-white/10"
        >
          Cancel
        </button>
        <button
          onClick={handlePaymentDone}
          disabled={!refValid || submitting || totalPrice === null}
          className="flex-1 rounded-2xl bg-teal-500 px-6 py-4 text-lg font-bold text-teal-950 shadow-[0_0_20px_rgba(45,212,191,0.35)] transition hover:bg-teal-400 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? 'Confirming…' : 'Payment Done'}
        </button>
      </div>
    </div>
  )
}

export default function Mode2PaymentPage() {
  return (
    <Suspense fallback={null}>
      <Mode2PaymentInner />
    </Suspense>
  )
}
