import Link from 'next/link'

// ---------------------------------------------------------------------------
// /admin — Fleet Dashboard (placeholder)
//
// Protected by middleware: requires valid Supabase Auth session.
// Will be expanded in Phase 4 with live kiosk grid, jobs today, revenue.
// ---------------------------------------------------------------------------

export default function AdminDashboardPage() {
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
            <Link href="/admin" className="font-medium text-emerald-500">
              Dashboard
            </Link>
            <Link href="/admin/kiosks" className="text-zinc-400 transition hover:text-zinc-100">
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
        <h2 className="mb-2 text-3xl font-bold tracking-tight">Fleet Dashboard</h2>
        <p className="mb-8 text-zinc-500">
          Overview of all kiosks, jobs, and revenue across your fleet.
        </p>

        {/* Placeholder Stats Grid */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Kiosks" value="—" />
          <StatCard label="Online Now" value="—" />
          <StatCard label="Jobs Today" value="—" />
          <StatCard label="Revenue Today" value="₹ —" />
        </div>

        <div className="mt-12 rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          <p className="text-zinc-500">
            Fleet status grid and live metrics will appear here once kiosks are added.
          </p>
          <Link
            href="/admin/kiosks"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Your First Kiosk
          </Link>
        </div>
      </main>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  )
}
