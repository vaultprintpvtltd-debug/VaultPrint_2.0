import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { acceptedUploadExtensions, getUploadType } from '@vaultprint/lib/convert'

// ---------------------------------------------------------------------------
// POST /api/upload/presign
//
// Returns a Supabase Storage signed upload URL for direct browser upload.
// The server never touches the file bytes — the browser PUTs directly
// to the presigned URL.
//
// Request:  { session_id: string, file_name: string, file_size: number }
// Response: { upload_url, file_path, token, content_type }
//
// PDFs go straight to {kiosk_id}/{job_id}.pdf. Images and Word documents
// go to {kiosk_id}/{job_id}.src.{ext} and are converted to that same .pdf
// path by /api/upload/confirm — the print agent only ever sees a PDF.
//
// GET → { extensions } — the file types this deployment accepts.
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

// Create a pure admin client that ignores browser cookies
function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false }
    }
  )
}

export async function GET() {
  return NextResponse.json({ extensions: acceptedUploadExtensions() })
}

export async function POST(request: NextRequest) {
  let body: { session_id?: string; file_name?: string; file_size?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { session_id, file_name, file_size } = body

  if (!session_id || !file_name || file_size === undefined) {
    return NextResponse.json(
      { error: 'session_id, file_name, and file_size are required' },
      { status: 400 }
    )
  }

  // ── Validate file size ────────────────────────────────────────────────
  if (file_size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File size exceeds limit. Maximum: ${MAX_FILE_SIZE / 1024 / 1024}MB` },
      { status: 413 }
    )
  }

  // ── Validate file type ────────────────────────────────────────────────
  const uploadType = getUploadType(file_name)
  if (!uploadType) {
    const accepted = acceptedUploadExtensions().map((e) => e.toUpperCase()).join(', ')
    return NextResponse.json(
      { error: `Unsupported file type. Accepted: ${accepted}` },
      { status: 415 }
    )
  }

  const supabase = getAdminSupabase()

  // ── Validate session exists ───────────────────────────────────────────
  const { data: job, error: jobError } = await supabase
    .from('print_jobs')
    .select('id, kiosk_id, status')
    .eq('session_id', session_id)
    .single()

  if (jobError || !job) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  if (job.status !== 'created') {
    return NextResponse.json(
      { error: 'File already uploaded for this session' },
      { status: 409 }
    )
  }

  // ── Generate presigned upload URL ─────────────────────────────────────
  // Path: print-files/{kiosk_id}/{job_id}.pdf (or .src.{ext} pending conversion)
  const filePath =
    uploadType.kind === 'pdf'
      ? `${job.kiosk_id}/${job.id}.pdf`
      : `${job.kiosk_id}/${job.id}.src.${uploadType.ext}`

  // upsert: a failed upload/confirm can be retried within the same session
  const { data: signedData, error: signError } = await supabase.storage
    .from('print-files')
    .createSignedUploadUrl(filePath, { upsert: true })

  if (signError || !signedData) {
    console.error('Failed to create upload URL:', signError)
    return NextResponse.json(
      { error: 'Failed to create upload URL', details: signError?.message },
      { status: 500 }
    )
  }

  // ── Update job with file_name ─────────────────────────────────────────
  await supabase
    .from('print_jobs')
    .update({ file_name: file_name, file_path: filePath })
    .eq('id', job.id)

  return NextResponse.json({
    upload_url: signedData.signedUrl,
    file_path: filePath,
    token: signedData.token,
    content_type: uploadType.mime,
  })
}
