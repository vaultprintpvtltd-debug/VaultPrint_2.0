'use client'

import { useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useDropzone } from 'react-dropzone'

// ---------------------------------------------------------------------------
// /print/[sessionId] — File Upload UI
//
// Allows user to drag-drop or select a PDF file.
// 1. Calls /api/upload/presign to get a Supabase Storage signed URL
// 2. Uses XMLHttpRequest to upload directly to Storage (with progress bar)
// 3. Calls /api/upload/confirm to extract page count and update job
// ---------------------------------------------------------------------------

export default function PrintUploadPage() {
  const params = useParams<{ sessionId: string }>()
  const router = useRouter()
  const sessionId = params.sessionId

  const [file, setFile] = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [status, setStatus] = useState<'idle' | 'uploading' | 'processing' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [totalPages, setTotalPages] = useState<number | null>(null)

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0])
      setStatus('idle')
      setErrorMsg(null)
      setUploadProgress(0)
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    maxSize: 50 * 1024 * 1024, // 50MB
  })

  async function handleUpload() {
    if (!file) return

    setStatus('uploading')
    setErrorMsg(null)

    try {
      // 1. Get presigned URL
      const presignRes = await fetch('/api/upload/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          file_name: file.name,
          file_size: file.size,
        }),
      })

      if (!presignRes.ok) {
        const errorData = await presignRes.json()
        const fullMessage = errorData.details 
          ? `${errorData.error} (${errorData.details})` 
          : errorData.error || 'Failed to get upload URL'
        throw new Error(fullMessage)
      }

      const { upload_url, file_path } = await presignRes.json()

      // 2. Upload file using XMLHttpRequest to track progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', upload_url, true)
        xhr.setRequestHeader('Content-Type', 'application/pdf')

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percentComplete = Math.round((e.loaded / e.total) * 100)
            setUploadProgress(percentComplete)
          }
        }

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve()
          } else {
            reject(new Error('Upload failed'))
          }
        }

        xhr.onerror = () => reject(new Error('Network error during upload'))
        xhr.send(file)
      })

      setStatus('processing')

      // 3. Confirm upload and get page count
      const confirmRes = await fetch('/api/upload/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, file_path }),
      })

      if (!confirmRes.ok) {
        const errorData = await confirmRes.json()
        throw new Error(errorData.error || 'Failed to process PDF')
      }

      const confirmData = await confirmRes.json()
      setTotalPages(confirmData.total_pages)
      setStatus('success')

    } catch (err: any) {
      console.error('Upload error:', err)
      setStatus('error')
      setErrorMsg(err.message || 'An unexpected error occurred')
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/80 p-4 backdrop-blur-sm">
        <h1 className="text-lg font-bold">VaultPrint</h1>
      </header>

      <main className="flex flex-1 flex-col p-6">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-bold">Upload Document</h2>
          <p className="mt-2 text-zinc-400">Select the PDF you want to print.</p>
        </div>

        {/* Upload Area */}
        <div
          {...getRootProps()}
          className={`relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
            isDragActive
              ? 'border-emerald-500 bg-emerald-500/10'
              : 'border-zinc-700 bg-zinc-900 hover:border-zinc-500 hover:bg-zinc-800'
          } ${status === 'uploading' || status === 'processing' || status === 'success' ? 'pointer-events-none opacity-50' : ''}`}
        >
          <input {...getInputProps()} />
          <svg className="mb-4 h-12 w-12 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          {file ? (
            <div>
              <p className="font-semibold text-emerald-400">{file.name}</p>
              <p className="mt-1 text-sm text-zinc-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
          ) : (
            <div>
              <p className="font-medium text-zinc-300">Tap to select or drag and drop</p>
              <p className="mt-1 text-sm text-zinc-500">PDF up to 50MB</p>
            </div>
          )}
        </div>

        {/* Error Message */}
        {status === 'error' && errorMsg && (
          <div className="mt-6 rounded-lg bg-red-500/10 p-4 text-center text-sm text-red-400 border border-red-500/20">
            {errorMsg}
          </div>
        )}

        {/* Progress & Status */}
        {(status === 'uploading' || status === 'processing') && (
          <div className="mt-8 flex flex-col items-center">
            <div className="mb-2 flex w-full justify-between text-sm">
              <span className="text-zinc-400">
                {status === 'uploading' ? 'Uploading...' : 'Processing PDF...'}
              </span>
              <span className="font-medium text-emerald-400">{uploadProgress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full bg-emerald-500 transition-all duration-300 ease-out"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Success Info */}
        {status === 'success' && (
          <div className="mt-8 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20">
              <svg className="h-6 w-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-emerald-400">Upload Complete</h3>
            <p className="mt-1 text-zinc-400">Your document has {totalPages} pages.</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-auto pt-8">
          {status === 'idle' && file && (
            <button
              onClick={handleUpload}
              className="w-full rounded-lg bg-emerald-600 py-3.5 font-bold text-white transition hover:bg-emerald-500"
            >
              Upload Document
            </button>
          )}

          {status === 'success' && (
            <button
              onClick={() => router.push(`/customize/${sessionId}`)}
              className="w-full rounded-lg bg-emerald-600 py-3.5 font-bold text-white transition hover:bg-emerald-500"
            >
              Continue to Settings
            </button>
          )}

          {(status === 'error' || status === 'success') && (
            <button
              onClick={() => {
                setFile(null)
                setStatus('idle')
                setErrorMsg(null)
                setUploadProgress(0)
              }}
              className="mt-4 w-full rounded-lg py-3.5 font-medium text-zinc-400 transition hover:text-zinc-200"
            >
              Upload a different file
            </button>
          )}
        </div>
      </main>
    </div>
  )
}
