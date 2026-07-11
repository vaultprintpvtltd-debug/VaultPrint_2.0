'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient, type PrintJobRow } from '@vaultprint/db'
import { useKioskConfig } from '@/hooks/use-kiosk-config'
import { getSchoolOfflineMode } from '@vaultprint/lib/kiosk-config'
import { kioskApi } from '@/lib/kiosk-api'

// ---------------------------------------------------------------------------
// /kiosk/[kioskId]/mode2/customize — large touch UI, live price (PRD C2.4)
//
// Live price is computed client-side from pricing_config for display;
// the AUTHORITATIVE price is recomputed server-side in mode2/customize.
// ---------------------------------------------------------------------------

interface PriceRow {
  color_mode: string
  duplex: boolean
  price_per_page: number
}

function Mode2CustomizeInner() {
  const params = useParams<{ kioskId: string }>()
  const search = useSearchParams()
  const router = useRouter()
  const kioskId = params.kioskId
  const jobId = search.get('jobId')

  const { config } = useKioskConfig(kioskId)
  const school = config ? getSchoolOfflineMode(config) : undefined

  const [totalPages, setTotalPages] = useState<number | null>(null)
  const [fileName, setFileName] = useState<string>('')
  const [pricing, setPricing] = useState<PriceRow[]>([])
  const [colorMode, setColorMode] = useState<'bw' | 'colour'>('bw')
  const [copies, setCopies] = useState(1)
  const [duplex, setDuplex] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Load job + pricing (anon reads, allowed by RLS) ────────────────────
  useEffect(() => {
    if (!jobId) return

    async function load() {
      const supabase = createBrowserClient()
      // Explicit cast: supabase-js result inference degrades to `never`
      // inside nested closures with this TS version.
      const { data: job } = (await supabase
        .from('print_jobs')
        .select('id, total_pages, file_name, status')
        .eq('id', jobId!)
        .eq('kiosk_id', kioskId)
        .single()) as {
        data: Pick<PrintJobRow, 'id' | 'total_pages' | 'file_name' | 'status'> | null
      }

      if (job) {
        setTotalPages(job.total_pages ?? 1)
        setFileName(job.file_name ?? 'document.pdf')
      }

      const { data: rows } = (await supabase
        .from('pricing_config')
        .select('color_mode, duplex, price_per_page')
        .eq('paper_size', 'A4')
        .eq('is_active', true)) as { data: PriceRow[] | null }

      if (rows) setPricing(rows)
    }

    load()
  }, [jobId, kioskId])

  // ── Session timeout → auto-cancel ──────────────────────────────────────
  useEffect(() => {
    if (!school || !jobId) return
    const t = setTimeout(async () => {
      await kioskApi(kioskId, '/mode2/cancel', { job_id: jobId })
      router.push(`/kiosk/${kioskId}`)
    }, school.session_timeout_minutes * 60 * 1000)
    return () => clearTimeout(t)
  }, [school, jobId, kioskId, router])

  const pricePerPage = useMemo(() => {
    const row = pricing.find((p) => p.color_mode === colorMode && p.duplex === duplex)
    return row ? Number(row.price_per_page) : null
  }, [pricing, colorMode, duplex])

  const livePrice =
    pricePerPage !== null && totalPages !== null
      ? (pricePerPage * totalPages * copies).toFixed(2)
      : null

  async function handleContinue() {
    if (!jobId) return
    setSubmitting(true)
    setError(null)
    const { ok, data } = await kioskApi(kioskId, '/mode2/customize', {
      job_id: jobId,
      color_mode: colorMode,
      copies,
      duplex,
    })
    if (!ok) {
      setError(data.error || 'Failed to save settings.')
      setSubmitting(false)
      return
    }
    router.push(`/kiosk/${kioskId}/mode2/payment?jobId=${jobId}`)
  }

  async function handleCancel() {
    await kioskApi(kioskId, '/mode2/cancel', { job_id: jobId })
    router.push(`/kiosk/${kioskId}`)
  }

  if (!jobId) {
    router.push(`/kiosk/${kioskId}`)
    return null
  }

  const optionBtn = (active: boolean) =>
    `flex-1 rounded-2xl border px-4 py-4 text-base lg:text-lg font-semibold transition-all ${
      active
        ? 'border-teal-400 bg-teal-400/10 text-teal-300 shadow-[0_0_12px_rgba(45,212,191,0.25)]'
        : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
    }`

  return (
    <div className="flex w-full max-w-[440px] flex-col gap-4">
      <div className="text-center">
        <h2 className="text-xl lg:text-2xl font-bold text-white tracking-wide">Print settings</h2>
        <p className="mt-1 truncate text-sm text-zinc-400">
          {fileName} · {totalPages ?? '…'} page{totalPages === 1 ? '' : 's'}
        </p>
      </div>

      {/* Colour */}
      <div className="flex gap-3">
        <button onClick={() => setColorMode('bw')} className={optionBtn(colorMode === 'bw')}>
          Black &amp; White
        </button>
        <button onClick={() => setColorMode('colour')} className={optionBtn(colorMode === 'colour')}>
          Colour
        </button>
      </div>

      {/* Sides */}
      <div className="flex gap-3">
        <button onClick={() => setDuplex(false)} className={optionBtn(!duplex)}>
          Single-sided
        </button>
        <button onClick={() => setDuplex(true)} className={optionBtn(duplex)}>
          Double-sided
        </button>
      </div>

      {/* Copies */}
      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-5 py-3">
        <span className="text-base lg:text-lg font-semibold text-zinc-300">Copies</span>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setCopies((c) => Math.max(1, c - 1))}
            className="h-11 w-11 rounded-xl border border-white/10 bg-black/30 text-2xl font-bold text-white transition active:scale-95"
          >
            −
          </button>
          <span className="w-8 text-center font-jakarta text-2xl font-bold text-teal-400">{copies}</span>
          <button
            onClick={() => setCopies((c) => Math.min(9, c + 1))}
            className="h-11 w-11 rounded-xl border border-white/10 bg-black/30 text-2xl font-bold text-white transition active:scale-95"
          >
            +
          </button>
        </div>
      </div>

      {/* Live price */}
      <div className="flex items-center justify-between rounded-2xl border border-teal-400/20 bg-[#163b3e]/70 px-5 py-4 shadow-inner">
        <span className="text-base font-semibold text-zinc-300">Total</span>
        <span className="font-jakarta text-2xl lg:text-3xl font-extrabold text-teal-400">
          {livePrice !== null ? `₹${livePrice}` : '—'}
        </span>
      </div>

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
          onClick={handleContinue}
          disabled={submitting || livePrice === null}
          className="flex-1 rounded-2xl bg-teal-500 px-6 py-4 text-lg font-bold text-teal-950 shadow-[0_0_20px_rgba(45,212,191,0.35)] transition hover:bg-teal-400 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Continue to payment'}
        </button>
      </div>
    </div>
  )
}

export default function Mode2CustomizePage() {
  return (
    <Suspense fallback={null}>
      <Mode2CustomizeInner />
    </Suspense>
  )
}
