import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// POST /api/upload/presign
//
// Returns a Supabase Storage signed upload URL for direct browser upload.
// The server never touches the file bytes — the browser PUTs directly
// to the presigned URL.
//
// Request:  { session_id: string, file_name: string, file_size: number }
// Response: { upload_url: string, file_path: string, token: string }
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

  // ── Validate file is PDF ──────────────────────────────────────────────
  if (!file_name.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json(
      { error: 'Only PDF files are accepted' },
      { status: 400 }
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
  // Path: print-files/{kiosk_id}/{job_id}.pdf
  const filePath = `${job.kiosk_id}/${job.id}.pdf`

  const { data: signedData, error: signError } = await supabase.storage
    .from('print-files')
    .createSignedUploadUrl(filePath)

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
  })
}
