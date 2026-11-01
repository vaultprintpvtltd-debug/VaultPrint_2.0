import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument } from 'pdf-lib'
import { convertToPdf, getUploadType } from '@vaultprint/lib/convert'

// ---------------------------------------------------------------------------
// POST /api/upload/confirm
//
// Called after the browser completes the direct upload to Storage.
// Downloads the file from Storage into a buffer, converts images / Word
// documents to PDF (stored at {kiosk_id}/{job_id}.pdf, source deleted),
// uses pdf-lib to extract the page count, then updates the print_jobs row.
//
// Request:  { session_id: string, file_path: string }
// Response: { ok: true, total_pages: number }
// ---------------------------------------------------------------------------

// Word conversion can take a few seconds on a cold conversion service
export const maxDuration = 60

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

  // The path must be the one presign issued for THIS job — never a
  // client-chosen object (which could be another customer's file).
  if (!job.file_path || file_path !== job.file_path) {
    return NextResponse.json({ error: 'File path does not match this session' }, { status: 400 })
  }

  if (job.status !== 'created') {
    return NextResponse.json(
      { error: 'File already uploaded for this session' },
      { status: 409 }
    )
  }

  const uploadType = getUploadType(file_path)
  if (!uploadType) {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 415 })
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

  let pdfBytes = new Uint8Array(await fileData.arrayBuffer())
  const pdfPath = `${job.kiosk_id}/${job.id}.pdf`

  // ── Convert images / Word documents to PDF ────────────────────────────
  if (uploadType.kind !== 'pdf') {
    try {
      pdfBytes = new Uint8Array(await convertToPdf(pdfBytes, uploadType, file_path))
    } catch (err) {
      console.error('Upload conversion failed:', err)
      return NextResponse.json(
        {
          error:
            uploadType.kind === 'image'
              ? 'Could not read this image. Please upload a JPG, PNG or PDF.'
              : 'Could not convert this document. Please save it as PDF and upload again.',
        },
        { status: 422 }
      )
    }
  }

  // ── Extract page count with pdf-lib ───────────────────────────────────
  let totalPages: number
  try {
    const pdfDoc = await PDFDocument.load(pdfBytes)
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

  // ── Store the converted PDF, drop the source ──────────────────────────
  if (uploadType.kind !== 'pdf') {
    const { error: storeError } = await supabase.storage
      .from('print-files')
      .upload(pdfPath, pdfBytes, { contentType: 'application/pdf', upsert: true })

    if (storeError) {
      return NextResponse.json(
        { error: 'Failed to store converted file', details: storeError.message },
        { status: 500 }
      )
    }

    await supabase.storage.from('print-files').remove([file_path])
  }

  // ── Update print_jobs row ─────────────────────────────────────────────
  const { error: updateError } = await supabase
    .from('print_jobs')
    .update({
      file_path: pdfPath,
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
    metadata: { total_pages: totalPages, file_path: pdfPath, source_type: uploadType.ext },
  })

  return NextResponse.json({ ok: true, total_pages: totalPages })
}
