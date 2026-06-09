'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

// ---------------------------------------------------------------------------
// /admin/kiosks — Kiosk Management
//
// Lists all kiosks in a table and provides an "Add Kiosk" form.
// On creation, the API returns the plain API key exactly once — displayed
// in a prominent box for the admin to copy before navigating away.
// ---------------------------------------------------------------------------

interface Kiosk {
  id: string
  name: string
  location: string | null
  status: string
  printer_name: string
  os_platform: string | null
  last_heartbeat: string | null
  created_at: string
}

interface NewKioskForm {
  name: string
  location: string
  printer_name: string
}

export default function AdminKiosksPage() {
  const [kiosks, setKiosks] = useState<Kiosk[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<NewKioskForm>({
    name: '',
    location: '',
    printer_name: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Newly created kiosk — shown once after creation
  const [newKioskResult, setNewKioskResult] = useState<{
    id: string
    api_key: string
  } | null>(null)

  // ── Fetch all kiosks ───────────────────────────────────────────────────
  const fetchKiosks = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/kiosks')
      if (!res.ok) throw new Error('Failed to fetch kiosks')
      const data = await res.json()
      setKiosks(data.kiosks)
      setLoading(false)
    } catch {
      setError('Failed to load kiosks.')
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchKiosks()
  }, [fetchKiosks])

  // ── Handle form submission ─────────────────────────────────────────────
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSubmitting(true)

    try {
      const res = await fetch('/api/admin/kiosks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      if (!res.ok) {
        const errorData = await res.json()
        setFormError(errorData.error || 'Failed to create kiosk')
        setSubmitting(false)
        return
      }

      const data = await res.json()

      // Store the result (contains the plain API key shown once)
      setNewKioskResult({ id: data.kiosk.id, api_key: data.api_key })

      // Reset form
      setForm({ name: '', location: '', printer_name: '' })
      setShowForm(false)
      setSubmitting(false)

      // Refresh the kiosk list
      fetchKiosks()
    } catch {
      setFormError('An unexpected error occurred.')
      setSubmitting(false)
    }
  }

  // ── Handle delete ──────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this kiosk? This action cannot be undone.')) {
      return
    }

    setDeletingId(id)
    try {
      const res = await fetch(`/api/admin/kiosks/${id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const errorData = await res.json()
        alert(errorData.error || 'Failed to delete kiosk')
        return
      }

      // Refresh the kiosk list
      fetchKiosks()
    } catch {
      alert('An unexpected error occurred.')
    } finally {
      setDeletingId(null)
    }
  }

  // ── Format helper ──────────────────────────────────────────────────────
  function formatHeartbeat(ts: string | null): string {
    if (!ts) return 'Never'
    const diff = Date.now() - new Date(ts).getTime()
    const seconds = Math.floor(diff / 1000)
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ago`
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10">
              <svg className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
            </div>
            <h1 className="text-lg font-bold">VaultPrint Admin</h1>
          </div>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/admin" className="text-zinc-400 transition hover:text-zinc-100">
              Dashboard
            </Link>
            <Link href="/admin/kiosks" className="font-medium text-emerald-500">
              Kiosks
            </Link>
            <Link href="/admin/jobs" className="text-zinc-400 transition hover:text-zinc-100">
              Jobs
            </Link>
            <Link href="/admin/pricing" className="text-zinc-400 transition hover:text-zinc-100">
              Pricing
            </Link>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-6 py-12">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Kiosks</h2>
            <p className="mt-1 text-zinc-500">
              Manage your fleet. Add a kiosk to get its UUID and API key.
            </p>
          </div>
          <button
            onClick={() => { setShowForm(!showForm); setNewKioskResult(null) }}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Kiosk
          </button>
        </div>

        {/* ── New Kiosk API Key Alert ────────────────────────────────── */}
        {newKioskResult && (
          <div className="mb-8 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6">
            <div className="mb-2 flex items-center gap-2">
              <svg className="h-5 w-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h3 className="text-lg font-bold text-amber-400">
                Kiosk Created — Copy These Values Now
              </h3>
            </div>
            <p className="mb-4 text-sm text-amber-300/80">
              The API key is shown <strong>exactly once</strong>. Copy it to the kiosk PC&apos;s <code className="rounded bg-amber-500/20 px-1.5 py-0.5">agent/.env</code> file before closing this alert.
            </p>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-amber-400/70">
                  KIOSK_ID
                </label>
                <code className="block rounded-lg bg-zinc-900 px-4 py-2.5 font-mono text-sm text-zinc-100 select-all">
                  {newKioskResult.id}
                </code>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-amber-400/70">
                  KIOSK_API_KEY
                </label>
                <code className="block rounded-lg bg-zinc-900 px-4 py-2.5 font-mono text-sm text-zinc-100 select-all">
                  {newKioskResult.api_key}
                </code>
              </div>
            </div>
            <button
              onClick={() => setNewKioskResult(null)}
              className="mt-4 text-sm font-medium text-amber-400 transition hover:text-amber-300"
            >
              I&apos;ve copied these values — dismiss
            </button>
          </div>
        )}

        {/* ── Add Kiosk Form ─────────────────────────────────────────── */}
        {showForm && (
          <form
            onSubmit={handleCreate}
            className="mb-8 rounded-2xl border border-zinc-800 bg-zinc-900 p-6"
          >
            <h3 className="mb-4 text-lg font-bold">New Kiosk</h3>

            {formError && (
              <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="kiosk-name" className="mb-1.5 block text-sm font-medium text-zinc-300">
                  Kiosk Name <span className="text-red-400">*</span>
                </label>
                <input
                  id="kiosk-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  placeholder="BIT Mesra — Library Ground Floor"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30"
                />
              </div>
              <div>
                <label htmlFor="kiosk-location" className="mb-1.5 block text-sm font-medium text-zinc-300">
                  Location
                </label>
                <input
                  id="kiosk-location"
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="Near entrance, left side"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30"
                />
              </div>
              <div>
                <label htmlFor="kiosk-printer" className="mb-1.5 block text-sm font-medium text-zinc-300">
                  Printer Name <span className="text-red-400">*</span>
                </label>
                <input
                  id="kiosk-printer"
                  type="text"
                  value={form.printer_name}
                  onChange={(e) => setForm({ ...form, printer_name: e.target.value })}
                  required
                  placeholder="Canon G2000 series"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Creating…
                  </>
                ) : (
                  'Create Kiosk'
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg px-4 py-2.5 text-sm text-zinc-400 transition hover:text-zinc-100"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* ── Kiosks Table ───────────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-700 border-t-emerald-500" />
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-8 text-center text-red-400">
            {error}
          </div>
        ) : kiosks.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-12 text-center">
            <p className="text-zinc-500">No kiosks yet. Click &quot;Add Kiosk&quot; to create your first one.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/80">
                  <th className="px-4 py-3 text-left font-semibold text-zinc-300">Name</th>
                  <th className="px-4 py-3 text-left font-semibold text-zinc-300">Location</th>
                  <th className="px-4 py-3 text-left font-semibold text-zinc-300">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-zinc-300">Printer</th>
                  <th className="px-4 py-3 text-left font-semibold text-zinc-300">OS</th>
                  <th className="px-4 py-3 text-left font-semibold text-zinc-300">Last Heartbeat</th>
                  <th className="px-4 py-3 text-left font-semibold text-zinc-300">ID</th>
                  <th className="px-4 py-3 text-right font-semibold text-zinc-300">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {kiosks.map((kiosk) => (
                  <tr key={kiosk.id} className="transition hover:bg-zinc-900/50">
                    <td className="px-4 py-3 font-medium text-zinc-100">{kiosk.name}</td>
                    <td className="px-4 py-3 text-zinc-400">{kiosk.location || '—'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={kiosk.status} />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">{kiosk.printer_name}</td>
                    <td className="px-4 py-3 text-zinc-400">{kiosk.os_platform || '—'}</td>
                    <td className="px-4 py-3 text-zinc-400">{formatHeartbeat(kiosk.last_heartbeat)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(kiosk.id)
                          alert('Kiosk ID copied to clipboard!')
                        }}
                        className="transition hover:text-emerald-400 flex items-center gap-1 group"
                        title="Click to copy"
                      >
                        {kiosk.id}
                        <svg className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(kiosk.id)}
                        disabled={deletingId === kiosk.id}
                        className="rounded px-2 py-1 text-xs font-medium text-red-400 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                      >
                        {deletingId === kiosk.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// StatusBadge — color-coded kiosk status indicator
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; dot: string }> = {
    online:   { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-500' },
    idle:     { bg: 'bg-emerald-500/10', text: 'text-emerald-400', dot: 'bg-emerald-500' },
    printing: { bg: 'bg-amber-500/10',   text: 'text-amber-400',   dot: 'bg-amber-500' },
    offline:  { bg: 'bg-red-500/10',     text: 'text-red-400',     dot: 'bg-red-500' },
  }
  const c = config[status] || config.offline

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full ${c.bg} px-2.5 py-1 text-xs font-medium ${c.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {status}
    </span>
  )
}
