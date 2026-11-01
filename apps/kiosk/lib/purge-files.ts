import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// purgeJobFiles — delete customer files that can no longer be printed.
//
//   completed / expired / refunded → deleted on the next sweep
//   failed                         → kept 24h (operator review / reprint)
//
// Deletion goes through the Storage API (storage.protect_delete forbids SQL
// deletes), then file_path is cleared so the job is never swept again.
// Called from the agent heartbeat (per kiosk, every 30s while online), the
// job-completion route, and the daily /api/cron/purge-files sweep.
// ---------------------------------------------------------------------------

const FAILED_RETENTION_MS = 24 * 60 * 60 * 1000

export async function purgeJobFiles(
  supabase: SupabaseClient,
  { kioskId, limit = 25 }: { kioskId?: string; limit?: number } = {}
): Promise<number> {
  const failedCutoff = new Date(Date.now() - FAILED_RETENTION_MS).toISOString()

  let query = supabase
    .from('print_jobs')
    .select('id, file_path')
    .eq('payment_mode', 'razorpay') // Mode 1 only; Mode 2 manages its own files
    .not('file_path', 'is', null)
    .or(`status.in.(completed,expired,refunded),and(status.eq.failed,updated_at.lt.${failedCutoff})`)
    .limit(limit)

  if (kioskId) query = query.eq('kiosk_id', kioskId)

  const { data: jobs, error } = await query
  if (error || !jobs || jobs.length === 0) return 0

  const rows = jobs as { id: string; file_path: string }[]
  const { error: removeError } = await supabase.storage
    .from('print-files')
    .remove(rows.map((j) => j.file_path))

  if (removeError) {
    console.error('purgeJobFiles: storage remove failed', removeError)
    return 0
  }

  await supabase
    .from('print_jobs')
    .update({ file_path: null })
    .in('id', rows.map((j) => j.id))

  return rows.length
}
