'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '@vaultprint/db'

// ---------------------------------------------------------------------------
// /admin/pricing — Pricing Management
// ---------------------------------------------------------------------------

export default function AdminPricingPage() {
  const [pricing, setPricing] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const supabase = createBrowserClient()

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('pricing_config')
        .select('*')
        .order('color_mode')
        .order('duplex')
      if (data) setPricing(data)
      setLoading(false)
    }
    load()
  }, [supabase])

  async function updatePrice(id: string, newPriceStr: string) {
    const newPrice = parseFloat(newPriceStr)
    if (isNaN(newPrice)) return

    setSaving(id)
    try {
      const res = await fetch('/api/admin/pricing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, price_per_page: newPrice })
      })

      if (res.ok) {
        setPricing(prev => prev.map(p => p.id === id ? { ...p, price_per_page: newPrice } : p))
      }
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold">VaultPrint Admin</h1>
          </div>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/admin" className="text-zinc-400 transition hover:text-zinc-100">Dashboard</Link>
            <Link href="/admin/kiosks" className="text-zinc-400 transition hover:text-zinc-100">Kiosks</Link>
            <Link href="/admin/jobs" className="text-zinc-400 transition hover:text-zinc-100">Jobs</Link>
            <Link href="/admin/pricing" className="font-medium text-emerald-500">Pricing</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-12">
        <h2 className="mb-2 text-3xl font-bold tracking-tight">Pricing Management</h2>
        <p className="mb-8 text-zinc-500">Update cost per page for different print configurations.</p>

        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-950/50">
              <tr>
                <th className="px-6 py-4 font-medium text-zinc-400">Color Mode</th>
                <th className="px-6 py-4 font-medium text-zinc-400">Paper Size</th>
                <th className="px-6 py-4 font-medium text-zinc-400">Sides</th>
                <th className="px-6 py-4 font-medium text-zinc-400">Price per Page (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-zinc-500">Loading...</td>
                </tr>
              ) : (
                pricing.map((tier) => (
                  <tr key={tier.id} className="transition hover:bg-zinc-800/50">
                    <td className="px-6 py-4 font-medium text-zinc-200 capitalize">
                      {tier.color_mode === 'colour' ? 'Colour' : 'Black & White'}
                    </td>
                    <td className="px-6 py-4 text-zinc-400">{tier.paper_size}</td>
                    <td className="px-6 py-4 text-zinc-400">{tier.duplex ? 'Duplex' : 'Single Sided'}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="0.1"
                          defaultValue={tier.price_per_page}
                          onBlur={(e) => {
                            if (e.target.value && parseFloat(e.target.value) !== tier.price_per_page) {
                              updatePrice(tier.id, e.target.value)
                            }
                          }}
                          disabled={saving === tier.id}
                          className="w-24 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-zinc-200 outline-none focus:border-emerald-500 disabled:opacity-50"
                        />
                        {saving === tier.id && <span className="text-xs text-emerald-500">Saving...</span>}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
