import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument } from 'pdf-lib'

// ---------------------------------------------------------------------------
// POST /api/upload/confirm
//
// Called after the browser completes the direct upload to Storage.
// Downloads the file from Storage into a buffer, uses pdf-lib to extract
// the page count, then updates the print_jobs row.
//
// Request:  { session_id: string, file_path: string }
// Response: { ok: true, total_pages: number }
// ---------------------------------------------------------------------------

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false }
    }
  )
}

export async function POST(request: NextRequest) {
  let body: { session_id?: string; file_path?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { session_id, file_path } = body

  if (!session_id || !file_path) {
    return NextResponse.json(
      { error: 'session_id and file_path are required' },
      { status: 400 }
    )
  }

  const supabase = getAdminSupabase()

  // ── Validate session ──────────────────────────────────────────────────
  const { data: job, error: jobError } = await supabase
    .from('print_jobs')
    .select('id, kiosk_id, status, file_path')
    .eq('session_id', session_id)
    .single()

  if (jobError || !job) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // ── Download file from Supabase Storage ───────────────────────────────
  const { data: fileData, error: downloadError } = await supabase.storage
    .from('print-files')
    .download(file_path)

  if (downloadError || !fileData) {
    return NextResponse.json(
      { error: 'Failed to download file from storage', details: downloadError?.message },
      { status: 500 }
    )
  }

  // ── Extract page count with pdf-lib ───────────────────────────────────
  let totalPages: number
  try {
    const arrayBuffer = await fileData.arrayBuffer()
    const pdfDoc = await PDFDocument.load(arrayBuffer)
    totalPages = pdfDoc.getPageCount()
  } catch {
    return NextResponse.json(
      { error: 'Failed to read PDF. The file may be corrupted or password-protected.' },
      { status: 422 }
    )
  }

  if (totalPages === 0) {
    return NextResponse.json(
      { error: 'PDF has no pages' },
      { status: 422 }
    )
  }

  // ── Update print_jobs row ─────────────────────────────────────────────
  const { error: updateError } = await supabase
    .from('print_jobs')
    .update({
      file_path,
      total_pages: totalPages,
      status: 'uploaded',
    })
    .eq('id', job.id)

  if (updateError) {
    return NextResponse.json(
      { error: 'Failed to update job', details: updateError.message },
      { status: 500 }
    )
  }

  // ── Audit log ─────────────────────────────────────────────────────────
  await supabase.from('audit_log').insert({
    job_id: job.id,
    kiosk_id: job.kiosk_id,
    event: 'file_uploaded',
    actor: 'user',
    metadata: { total_pages: totalPages, file_path },
  })

  return NextResponse.json({ ok: true, total_pages: totalPages })
}
