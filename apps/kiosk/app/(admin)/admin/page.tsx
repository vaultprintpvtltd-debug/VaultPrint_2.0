import Link from 'next/link'
import { createServerClient } from '@vaultprint/db/server'

// ---------------------------------------------------------------------------
// /admin — Fleet Dashboard
// ---------------------------------------------------------------------------

export default async function AdminDashboardPage() {
  const supabase = await createServerClient()

  // Fetch Kiosks
  const { data: kiosks } = await supabase
    .from('kiosks')
    .select('id, name, location, last_heartbeat, status, os_platform, settings')
    .order('created_at', { ascending: false })

  // Stats
  const totalKiosks = kiosks?.length || 0
  const onlineKiosks = kiosks?.filter((k) => k.status === 'idle' || k.status === 'printing').length || 0

  // Today's jobs
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const { data: jobsToday } = await supabase
    .from('print_jobs')
    .select('id, total_price, status, payment_mode')
    .gte('created_at', startOfDay.toISOString())

  type JobRow = { id: string; total_price: number | string | null; status: string; payment_mode: string | null }
  const totalJobsToday = jobsToday?.length || 0
  const paidJobsToday = ((jobsToday as JobRow[]) || []).filter((j) =>
    ['paid', 'queued', 'printing', 'completed'].includes(j.status)
  )
  const revenueToday = paidJobsToday.reduce(
    (sum, j) => sum + (Number(j.total_price) || 0), 0
  )
  const revenueRazorpay = paidJobsToday
    .filter((j) => j.payment_mode !== 'pos')
    .reduce((sum, j) => sum + (Number(j.total_price) || 0), 0)
  const revenuePos = paidJobsToday
    .filter((j) => j.payment_mode === 'pos')
    .reduce((sum, j) => sum + (Number(j.total_price) || 0), 0)

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
            <Link href="/admin" className="font-medium text-emerald-500">Dashboard</Link>
            <Link href="/admin/kiosks" className="text-zinc-400 transition hover:text-zinc-100">Kiosks</Link>
            <Link href="/admin/jobs" className="text-zinc-400 transition hover:text-zinc-100">Jobs</Link>
            <Link href="/admin/pricing" className="text-zinc-400 transition hover:text-zinc-100">Pricing</Link>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-6 py-12">
        <h2 className="mb-2 text-3xl font-bold tracking-tight">Fleet Dashboard</h2>
        <p className="mb-8 text-zinc-500">Overview of all kiosks, jobs, and revenue across your fleet.</p>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Kiosks" value={totalKiosks.toString()} />
          <StatCard label="Online Now" value={onlineKiosks.toString()} />
          <StatCard label="Jobs Today" value={totalJobsToday.toString()} />
          <StatCard
            label="Revenue Today"
            value={`₹ ${revenueToday.toFixed(2)}`}
            sub={`Razorpay ₹ ${revenueRazorpay.toFixed(2)} · POS ₹ ${revenuePos.toFixed(2)}`}
          />
        </div>

        {/* Fleet Status */}
        <div className="mt-12">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-xl font-bold">Live Fleet Status</h3>
            <Link
              href="/admin/kiosks"
              className="text-sm font-medium text-emerald-500 hover:text-emerald-400"
            >
              Manage Kiosks →
            </Link>
          </div>
          <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-950/50">
                <tr>
                  <th className="px-6 py-4 font-medium text-zinc-400">Name & Location</th>
                  <th className="px-6 py-4 font-medium text-zinc-400">Status</th>
                  <th className="px-6 py-4 font-medium text-zinc-400">Platform</th>
                  <th className="px-6 py-4 font-medium text-zinc-400">Hotspot</th>
                  <th className="px-6 py-4 font-medium text-zinc-400">Last Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {!kiosks || kiosks.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-zinc-500">
                      No kiosks added yet.
                    </td>
                  </tr>
                ) : (
                  kiosks.map((kiosk) => {
                    const lastSeen = kiosk.last_heartbeat ? new Date(kiosk.last_heartbeat) : null
                    const isOffline = lastSeen ? (new Date().getTime() - lastSeen.getTime() > 60000) : true
                    const hotspotActive = (kiosk.settings as { hotspot_active?: boolean } | null)?.hotspot_active

                    return (
                      <tr key={kiosk.id} className="transition hover:bg-zinc-800/50">
                        <td className="px-6 py-4">
                          <div className="font-medium text-zinc-200">{kiosk.name}</div>
                          <div className="text-xs text-zinc-500">{kiosk.location || 'No location set'}</div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${
                            isOffline ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'
                          }`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${isOffline ? 'bg-red-500' : 'bg-emerald-500'}`} />
                            {isOffline ? 'Offline' : kiosk.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-zinc-400">
                          {kiosk.os_platform || '—'}
                        </td>
                        <td className="px-6 py-4">
                          {hotspotActive === undefined || hotspotActive === null ? (
                            <span className="text-zinc-600">—</span>
                          ) : hotspotActive ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2 py-1 text-xs font-medium text-red-400">
                              <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> Down
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-zinc-400">
                          {lastSeen ? lastSeen.toLocaleTimeString() : 'Never'}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-zinc-500 tabular-nums">{sub}</p>}
    </div>
  )
}
