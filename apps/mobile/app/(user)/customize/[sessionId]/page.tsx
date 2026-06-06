'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'

// ---------------------------------------------------------------------------
// /customize/[sessionId] — Print Settings Page
//
// 6 setting controls: Color Mode, Copies, Duplex, Orientation, Pages, Paper Size
// On any change: debounced PATCH /api/jobs/[id]/settings
// Shows live price calculation
// ---------------------------------------------------------------------------

interface PriceInfo {
  price_per_page: number
  billable_pages: number
  total_price: number
}

export default function CustomizePage() {
  const params = useParams<{ sessionId: string }>()
  const router = useRouter()
  const sessionId = params.sessionId

  // Settings state
  const [colorMode, setColorMode] = useState<'bw' | 'colour'>('bw')
  const [copies, setCopies] = useState(1)
  const [duplex, setDuplex] = useState(false)
  const [orientation, setOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto')
  const [pagesToPrint, setPagesToPrint] = useState('all')
  const [paperSize] = useState('A4')

  // Job info
  const [totalPages, setTotalPages] = useState<number | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  // Price
  const [price, setPrice] = useState<PriceInfo | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  // Fetch job info on mount
  useEffect(() => {
    async function fetchJob() {
      try {
        const res = await fetch(`/api/jobs/${sessionId}/status`)
        if (!res.ok) return
        const data = await res.json()
        // We need total_pages — fetch it via a settings PATCH with defaults
        // to also get initial price
        await saveSettings('bw', 1, false, 'auto', 'all')
        setLoaded(true)
      } catch {
        setError('Failed to load session')
      }
    }
    fetchJob()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // Save settings function
  const saveSettings = useCallback(
    async (
      cm: string = colorMode,
      cp: number = copies,
      dx: boolean = duplex,
      or: string = orientation,
      pp: string = pagesToPrint
    ) => {
      setSaving(true)
      setError(null)
      try {
        const res = await fetch(`/api/jobs/${sessionId}/settings`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            color_mode: cm,
            copies: cp,
            duplex: dx,
            orientation: or,
            pages_to_print: pp,
            paper_size: paperSize,
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          setError(data.error || 'Failed to save settings')
          return
        }

        const data = await res.json()
        setPrice({
          price_per_page: data.price_per_page,
          billable_pages: data.billable_pages,
          total_price: data.total_price,
        })
      } catch {
        setError('Network error saving settings')
      } finally {
        setSaving(false)
      }
    },
    [sessionId, colorMode, copies, duplex, orientation, pagesToPrint, paperSize]
  )

  // Debounced save on settings change
  useEffect(() => {
    if (!loaded) return
    const timer = setTimeout(() => {
      saveSettings()
    }, 400)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMode, copies, duplex, orientation, pagesToPrint, loaded])

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/80 p-4 backdrop-blur-sm">
        <h1 className="text-lg font-bold">VaultPrint</h1>
        <p className="text-sm text-zinc-400">Customize your print</p>
      </header>

      <main className="flex flex-1 flex-col p-6">
        {/* Error */}
        {error && (
          <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Settings Grid */}
        <div className="space-y-6">
          {/* Color Mode */}
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-300">Color Mode</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setColorMode('bw')}
                className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
                  colorMode === 'bw'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'
                }`}
              >
                🖤 Black & White
              </button>
              <button
                onClick={() => setColorMode('colour')}
                className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
                  colorMode === 'colour'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'
                }`}
              >
                🌈 Colour
              </button>
            </div>
          </div>

          {/* Copies */}
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-300">Copies</label>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setCopies((c) => Math.max(1, c - 1))}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-lg font-bold text-zinc-300 transition hover:border-zinc-500"
              >
                −
              </button>
              <span className="w-12 text-center text-xl font-bold tabular-nums">{copies}</span>
              <button
                onClick={() => setCopies((c) => Math.min(50, c + 1))}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-lg font-bold text-zinc-300 transition hover:border-zinc-500"
              >
                +
              </button>
            </div>
          </div>

          {/* Duplex */}
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-300">Print Sides</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setDuplex(false)}
                className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
                  !duplex
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'
                }`}
              >
                Single Side
              </button>
              <button
                onClick={() => setDuplex(true)}
                className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
                  duplex
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'
                }`}
              >
                Both Sides
              </button>
            </div>
          </div>

          {/* Orientation */}
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-300">Orientation</label>
            <div className="grid grid-cols-3 gap-3">
              {(['auto', 'portrait', 'landscape'] as const).map((o) => (
                <button
                  key={o}
                  onClick={() => setOrientation(o)}
                  className={`rounded-xl border px-3 py-3 text-sm font-medium capitalize transition ${
                    orientation === o
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>

          {/* Pages to Print */}
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-300">Pages</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setPagesToPrint('all')}
                className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
                  pagesToPrint === 'all'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'
                }`}
              >
                All Pages
              </button>
              <button
                onClick={() => setPagesToPrint('')}
                className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
                  pagesToPrint !== 'all'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                    : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'
                }`}
              >
                Custom Range
              </button>
            </div>
            {pagesToPrint !== 'all' && (
              <input
                type="text"
                value={pagesToPrint}
                onChange={(e) => setPagesToPrint(e.target.value)}
                placeholder="e.g. 1-5 or 1,3,5"
                className="mt-3 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-emerald-500"
              />
            )}
          </div>

          {/* Paper Size (read-only for v1) */}
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-300">Paper Size</label>
            <div className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-400">
              A4 (210 × 297 mm)
            </div>
          </div>
        </div>

        {/* Price Card */}
        {price && (
          <div className="mt-8 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5">
            <div className="flex items-center justify-between text-sm text-zinc-400">
              <span>{price.billable_pages} pages × ₹{price.price_per_page}</span>
              {saving && <span className="text-xs text-zinc-500">Saving…</span>}
            </div>
            <div className="mt-2 text-3xl font-bold text-emerald-400">
              ₹{price.total_price.toFixed(2)}
            </div>
          </div>
        )}

        {/* Continue Button */}
        <div className="mt-auto pt-8">
          <button
            onClick={() => router.push(`/payment/${sessionId}`)}
            disabled={!price || saving}
            className="w-full rounded-lg bg-emerald-600 py-3.5 font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Continue to Payment
          </button>
        </div>
      </main>
    </div>
  )
}
