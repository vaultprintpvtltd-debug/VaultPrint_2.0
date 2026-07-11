import Link from 'next/link'
import { createServerClient } from '@vaultprint/db/server'

// ---------------------------------------------------------------------------
// /admin/jobs — Job History
//
// Payment-method filter (?payment=razorpay|pos), Razorpay/POS badges,
// POS receipt refs, and an amount-discrepancy indicator
// (pos_client_amount ≠ total_price → reconciliation flag).
// ---------------------------------------------------------------------------

export default async function AdminJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string }>
}) {
  const { payment } = await searchParams
  const paymentFilter = payment === 'pos' || payment === 'razorpay' ? payment : null

  const supabase = await createServerClient()

  type JobRow = {
    id: string
    status: string
    copies: number
    total_pages: number | null
    color_mode: string
    duplex: boolean
    total_price: number | string | null
    payment_mode: string | null
    pos_transaction_ref: string | null
    pos_client_amount: number | string | null
    created_at: string
    kiosks: { name: string } | null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated DB types don't include mode2 columns yet
  let query = (supabase as any)
    .from('print_jobs')
    .select(`
      id,
      status,
      copies,
      total_pages,
      color_mode,
      duplex,
      total_price,
      payment_mode,
      pos_transaction_ref,
      pos_client_amount,
      created_at,
      kiosks ( name )
    `)
    .order('created_at', { ascending: false })
    .limit(100)

  if (paymentFilter) {
    query = query.eq('payment_mode', paymentFilter)
  }

  const { data: jobs } = await query

  const filterLink = (value: string | null, label: string) => {
    const active = paymentFilter === value
    return (
      <Link
        href={value ? `/admin/jobs?payment=${value}` : '/admin/jobs'}
        className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
          active
            ? 'bg-emerald-600 text-white'
            : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
        }`}
      >
        {label}
      </Link>
    )
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
            <Link href="/admin/jobs" className="font-medium text-emerald-500">Jobs</Link>
            <Link href="/admin/pricing" className="text-zinc-400 transition hover:text-zinc-100">Pricing</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-12">
        <h2 className="mb-2 text-3xl font-bold tracking-tight">Job History</h2>
        <p className="mb-6 text-zinc-500">Recent print jobs across all kiosks.</p>

        {/* Payment method filter */}
        <div className="mb-6 flex items-center gap-2">
          <span className="mr-1 text-xs uppercase tracking-wider text-zinc-500">Payment</span>
          {filterLink(null, 'All')}
          {filterLink('razorpay', 'Razorpay')}
          {filterLink('pos', 'POS')}
        </div>

        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-950/50">
              <tr>
                <th className="px-6 py-4 font-medium text-zinc-400">Date</th>
                <th className="px-6 py-4 font-medium text-zinc-400">Kiosk</th>
                <th className="px-6 py-4 font-medium text-zinc-400">Details</th>
                <th className="px-6 py-4 font-medium text-zinc-400">Payment</th>
                <th className="px-6 py-4 font-medium text-zinc-400">Price</th>
                <th className="px-6 py-4 font-medium text-zinc-400">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {!jobs || jobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-zinc-500">
                    No jobs found.
                  </td>
                </tr>
              ) : (
                (jobs as JobRow[]).map((job) => {
                  const isPos = job.payment_mode === 'pos'
                  const hasDiscrepancy =
                    isPos &&
                    job.pos_client_amount != null &&
                    job.total_price != null &&
                    Number(job.pos_client_amount) !== Number(job.total_price)

                  return (
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
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            isPos ? 'bg-sky-500/10 text-sky-400' : 'bg-violet-500/10 text-violet-400'
                          }`}>
                            {isPos ? 'POS' : 'Razorpay'}
                          </span>
                          {hasDiscrepancy && (
                            <span
                              className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400"
                              title={`Client-reported ₹${Number(job.pos_client_amount).toFixed(2)} ≠ job total ₹${Number(job.total_price).toFixed(2)}`}
                            >
                              ⚠ amount
                            </span>
                          )}
                        </div>
                        {isPos && job.pos_transaction_ref && (
                          <div className="mt-1 font-mono text-[11px] text-zinc-500">
                            ref {job.pos_transaction_ref}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 font-medium text-emerald-400">
                        {job.total_price ? `₹ ${Number(job.total_price).toFixed(2)}` : '—'}
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
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
