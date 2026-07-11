import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import path from 'path'
import { getPdfPageCount } from '@vaultprint/lib'

// ---------------------------------------------------------------------------
// POST /api/kiosk/[id]/mode2/session
//
// Called by agent/file-receiver.js after the iPad's PDF lands on the kiosk.
// Multipart form: token, local_path, file_name, file (the PDF bytes).
//
// Validation sequence — EXACT order per PRD C2.7:
//   1. Atomic token consumption (single UPDATE … RETURNING) — 0 rows → 403
//   2. Path allowlist — local_path must resolve under vaultprint-incoming → 400
//   3. Client filename is display-only; storage key is server-generated
//      print-files/{kiosk_id}/{job_id}.pdf
//   4. Real PDF check — must parse with pdf-lib; page-count cap enforced
//   5. Storage upload → print_jobs insert (status 'created',
//      payment_mode 'pos') → audit. (file-receiver deletes its temp file
//      on success; the sweeper catches every other case.)
// ---------------------------------------------------------------------------

const MAX_FILE_BYTES = 50 * 1024 * 1024 // 50 MB (same as Mode 1 / FR-10)
const MAX_PAGES = 200

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: kioskId } = await params
  const headerKioskId = request.headers.get('x-kiosk-id')

  if (headerKioskId && headerKioskId !== kioskId) {
    return NextResponse.json({ error: 'Kiosk ID mismatch' }, { status: 403 })
  }

  const supabase = getAdminSupabase()

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json(
      { error: 'Expected multipart/form-data body' },
      { status: 400 }
    )
  }

  const token = form.get('token')
  const localPath = form.get('local_path')
  const clientFileName = form.get('file_name')
  const file = form.get('file')

  if (typeof token !== 'string' || !token) {
    return NextResponse.json({ error: 'token is required' }, { status: 403 })
  }

  // ── 1. ATOMIC TOKEN CONSUMPTION ────────────────────────────────────────
  // Single UPDATE guarded by token + kiosk + unused + unexpired.
  // Zero rows back → not a valid live token → 403 + audit.
  const { data: consumed, error: consumeError } = await supabase
    .from('mode2_upload_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token)
    .eq('kiosk_id', kioskId)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('token')

  if (consumeError || !consumed || consumed.length === 0) {
    await supabase.from('audit_log').insert({
      kiosk_id: kioskId,
      event: 'mode2_token_rejected',
      actor: 'kiosk_agent',
      metadata: { reason: 'missing_used_expired_or_foreign_token' },
    })
    return NextResponse.json(
      { error: 'Invalid, expired, or already-used upload token' },
      { status: 403 }
    )
  }

  // ── 2. PATH ALLOWLIST ──────────────────────────────────────────────────
  // The receiver's temp dir is $HOME/vaultprint-incoming (Termux has no
  // /tmp). A path outside it means tampering — e.g. an attempt to make the
  // pipeline exfiltrate the kiosk's own .env. Normalise and require the
  // parent directory to be exactly vaultprint-incoming.
  if (typeof localPath !== 'string' || !localPath) {
    return NextResponse.json({ error: 'local_path is required' }, { status: 400 })
  }
  const normalized = path.posix.normalize(localPath.replace(/\\/g, '/'))
  const parentDir = path.posix.dirname(normalized)
  if (
    normalized.includes('..') ||
    path.posix.basename(parentDir) !== 'vaultprint-incoming'
  ) {
    await supabase.from('audit_log').insert({
      kiosk_id: kioskId,
      event: 'mode2_file_rejected',
      actor: 'kiosk_agent',
      metadata: { reason: 'path_outside_allowlist', local_path: String(localPath).slice(0, 200) },
    })
    return NextResponse.json(
      { error: 'local_path must be inside the vaultprint-incoming directory' },
      { status: 400 }
    )
  }

  // ── 3. FILE PRESENT / SIZE — filename is display-only ─────────────────
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }
  if (file.size === 0 || file.size > MAX_FILE_BYTES) {
    await supabase.from('audit_log').insert({
      kiosk_id: kioskId,
      event: 'mode2_file_rejected',
      actor: 'kiosk_agent',
      metadata: { reason: 'file_size', size: file.size },
    })
    return NextResponse.json(
      { error: `File must be between 1 byte and ${MAX_FILE_BYTES} bytes` },
      { status: 400 }
    )
  }

  // Sanitised display name only — never used as a storage key
  const displayName =
    (typeof clientFileName === 'string' && clientFileName
      ? clientFileName
      : file.name || 'document.pdf'
    )
      .replace(/[^\w.\- ()]/g, '_')
      .slice(0, 120)

  // ── 4. REAL PDF CHECK (pdf-lib parse) + PAGE CAP ───────────────────────
  const bytes = await file.arrayBuffer()
  let totalPages: number
  try {
    totalPages = await getPdfPageCount(bytes)
  } catch {
    await supabase.from('audit_log').insert({
      kiosk_id: kioskId,
      event: 'mode2_file_rejected',
      actor: 'kiosk_agent',
      metadata: { reason: 'not_a_valid_pdf', file_name: displayName },
    })
    return NextResponse.json(
      { error: 'File is not a valid PDF' },
      { status: 400 }
    )
  }
  if (totalPages < 1 || totalPages > MAX_PAGES) {
    await supabase.from('audit_log').insert({
      kiosk_id: kioskId,
      event: 'mode2_file_rejected',
      actor: 'kiosk_agent',
      metadata: { reason: 'page_count', total_pages: totalPages },
    })
    return NextResponse.json(
      { error: `PDF must have between 1 and ${MAX_PAGES} pages` },
      { status: 400 }
    )
  }

  // ── 5. STORAGE UPLOAD → JOB ROW → AUDIT ────────────────────────────────
  const jobId = crypto.randomUUID()
  const storagePath = `${kioskId}/${jobId}.pdf` // print-files/{kiosk}/{job}.pdf

  const { error: uploadError } = await supabase.storage
    .from('print-files')
    .upload(storagePath, bytes, { contentType: 'application/pdf' })

  if (uploadError) {
    return NextResponse.json(
      { error: 'Failed to store file', details: uploadError.message },
      { status: 500 }
    )
  }

  const { data: job, error: insertError } = await supabase
    .from('print_jobs')
    .insert({
      id: jobId,
      kiosk_id: kioskId,
      status: 'created',
      payment_mode: 'pos',
      file_path: storagePath,
      file_name: displayName,
      total_pages: totalPages,
    })
    .select('id, session_id')
    .single()

  if (insertError || !job) {
    // Roll back the orphaned storage object
    await supabase.storage.from('print-files').remove([storagePath])
    return NextResponse.json(
      { error: 'Failed to create print job', details: insertError?.message },
      { status: 500 }
    )
  }

  await supabase.from('audit_log').insert({
    job_id: job.id,
    kiosk_id: kioskId,
    event: 'mode2_session_created',
    actor: 'kiosk_agent',
    metadata: { file_name: displayName, total_pages: totalPages },
  })

  return NextResponse.json({
    job_id: job.id,
    session_id: job.session_id,
    total_pages: totalPages,
  })
}
