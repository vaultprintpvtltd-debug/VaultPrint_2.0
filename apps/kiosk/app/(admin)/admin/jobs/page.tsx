import Link from 'next/link'
import { createServerClient } from '@vaultprint/db/server'

// ---------------------------------------------------------------------------
// /admin/jobs — Job History
// ---------------------------------------------------------------------------

export default async function AdminJobsPage() {
  const supabase = await createServerClient()

  const { data: jobs } = await (supabase as any)
    .from('print_jobs')
    .select(`
      id,
      status,
      copies,
      total_pages,
      color_mode,
      duplex,
      total_price,
      created_at,
      kiosks ( name )
    `)
    .order('created_at', { ascending: false })
    .limit(100)

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
            <Link href="/admin/jobs" className="font-medium text-emerald-500">Jobs</Link>
            <Link href="/admin/pricing" className="text-zinc-400 transition hover:text-zinc-100">Pricing</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-12">
        <h2 className="mb-2 text-3xl font-bold tracking-tight">Job History</h2>
        <p className="mb-8 text-zinc-500">Recent print jobs across all kiosks.</p>

        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-950/50">
              <tr>
                <th className="px-6 py-4 font-medium text-zinc-400">Date</th>
                <th className="px-6 py-4 font-medium text-zinc-400">Kiosk</th>
                <th className="px-6 py-4 font-medium text-zinc-400">Details</th>
                <th className="px-6 py-4 font-medium text-zinc-400">Price</th>
                <th className="px-6 py-4 font-medium text-zinc-400">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {!jobs || jobs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-zinc-500">
                    No jobs found.
                  </td>
                </tr>
              ) : (
                (jobs as any[]).map((job: any) => (
                  <tr key={job.id} className="transition hover:bg-zinc-800/50">
                    <td className="px-6 py-4 text-zinc-400">
                      {new Date(job.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 font-medium text-zinc-200">
                      {job.kiosks?.name || 'Unknown'}
                    </td>
                    <td className="px-6 py-4 text-zinc-400">
                      {job.total_pages ? `${job.total_pages} pages` : 'No file'} · {job.copies}x · {job.color_mode === 'colour' ? 'Colour' : 'B&W'} · {job.duplex ? 'Duplex' : 'Single'}
                    </td>
                    <td className="px-6 py-4 font-medium text-emerald-400">
                      {job.total_price ? `₹ ${job.total_price.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                        job.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                        job.status === 'failed' || job.status === 'expired' ? 'bg-red-500/10 text-red-400' :
                        job.status === 'queued' || job.status === 'printing' ? 'bg-blue-500/10 text-blue-400' :
                        'bg-zinc-800 text-zinc-400'
                      }`}>
                        {job.status}
                      </span>
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
