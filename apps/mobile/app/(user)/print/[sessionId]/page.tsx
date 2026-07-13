'use client'

import { useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useDropzone } from 'react-dropzone'

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
        throw new Error(errorData.error || 'Failed to get upload URL')
      }

      const { upload_url, file_path } = await presignRes.json()

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

    } catch (err) {
      console.error('Upload error:', err)
      setStatus('error')
      setErrorMsg(err instanceof Error ? err.message : 'An unexpected error occurred')
    }
  }

  const steps = [
    { id: 1, name: 'Upload', active: true },
    { id: 2, name: 'Settings', active: false },
    { id: 3, name: 'Payment', active: false },
    { id: 4, name: 'OTP', active: false },
  ]

  return (
    <div className="flex flex-col flex-1 w-full max-w-lg mx-auto">
      
      {/* Mobile Stepper (Pinned near logo) */}
      <div className="mt-2 mb-2 px-2">
        <div className="flex items-center justify-between relative">
          {/* Progress Line */}
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-white/50 rounded-full z-0"></div>
          
          {steps.map((step) => (
            <div key={step.id} className="relative z-10 flex flex-col items-center gap-2">
              <div className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold transition-colors ${
                step.active 
                  ? 'bg-brand-blue text-white shadow-md ring-4 ring-white/50' 
                  : 'bg-white text-zinc-400 border border-zinc-200'
              }`}>
                {step.id}
              </div>
              <span className={`text-[10px] sm:text-xs font-semibold ${step.active ? 'text-navy' : 'text-zinc-400'}`}>
                {step.name}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Spacer to push card to vertical center */}
      <div className="flex flex-col flex-1 justify-center pb-8">
        {/* Glassmorphism Card */}
        <div className="flex flex-col bg-white/40 backdrop-blur-2xl border border-white/60 shadow-[0_8px_32px_0_rgba(31,38,135,0.1)] rounded-[2rem] p-5 sm:p-8 relative overflow-hidden">
        
        {/* Decorative glass shine */}
        <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/30 to-transparent pointer-events-none rounded-t-[2rem]"></div>

        <div className="mb-6 text-center relative z-10">
          <h1 className="text-2xl font-bold text-navy mb-1">Upload Document</h1>
          <p className="text-sm text-zinc-600">Select the PDF file you want to print.</p>
        </div>

        {/* Dropzone */}
        <div
          {...getRootProps()}
          className={`relative z-10 flex flex-col items-center justify-center w-full h-48 sm:h-56 rounded-2xl border-2 transition-all cursor-pointer shadow-sm ${
            isDragActive 
              ? 'border-brand-blue bg-brand-blue/10 scale-[1.02] backdrop-blur-md' 
              : 'border-white/80 border-dashed bg-white/50 hover:bg-white/70 hover:border-brand-blue/50 backdrop-blur-sm'
          } ${(status === 'uploading' || status === 'processing' || status === 'success') ? 'pointer-events-none opacity-60 grayscale-[20%]' : ''}`}
        >
          <input {...getInputProps()} />
          
          {!file && (
            <div className="flex flex-col items-center text-center px-4">
              <div className="w-14 h-14 bg-brand-blue/10 rounded-full flex items-center justify-center mb-3">
                <svg className="w-7 h-7 text-brand-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <p className="font-semibold text-navy text-base">Tap or drag PDF here</p>
              <p className="text-xs text-zinc-500 mt-1">Maximum file size 50MB</p>
            </div>
          )}

          {file && (
            <div className="flex flex-col items-center text-center px-4">
              <div className="w-14 h-14 bg-accent/20 rounded-2xl flex items-center justify-center mb-3">
                <svg className="w-7 h-7 text-brand-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
              </div>
              <p className="font-semibold text-navy text-sm max-w-[200px] truncate">{file.name}</p>
              <p className="text-xs font-medium text-brand-blue mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
          )}
        </div>

        {/* Action Button (Upload Trigger) */}
        {status === 'idle' && file && (
          <button
            onClick={handleUpload}
            className="w-full mt-6 bg-brand-blue hover:bg-brand-blue/90 text-white font-bold py-3.5 sm:py-4 rounded-xl shadow-[0_4px_14px_0_rgba(59,91,219,0.39)] transition-all active:scale-[0.98]"
          >
            Upload File
          </button>
        )}

        {/* Progress UI */}
        {(status === 'uploading' || status === 'processing') && (
          <div className="mt-6 flex flex-col w-full">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-semibold text-navy uppercase tracking-wider">
                {status === 'uploading' ? 'Uploading...' : 'Processing...'}
              </span>
              <span className="text-sm font-bold text-success-green">{uploadProgress}%</span>
            </div>
            <div className="w-full h-2.5 bg-zinc-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-success-green transition-all duration-300 ease-out" 
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Error UI */}
        {status === 'error' && errorMsg && (
          <div className="mt-6 w-full p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
            <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-medium text-red-700">{errorMsg}</p>
          </div>
        )}

        {/* Success Page Count Badge */}
        {status === 'success' && totalPages !== null && (
          <div className="mt-6 w-full p-4 bg-success-green/10 border border-success-green/20 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2">
            <div className="w-8 h-8 rounded-full bg-success-green/20 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-success-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-navy">Document Analyzed</p>
              <p className="text-xs font-medium text-success-green">{totalPages} pages detected</p>
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="mt-8 flex flex-col items-center gap-4">
          <button
            onClick={() => router.push(`/customize/${sessionId}`)}
            disabled={status !== 'success'}
            className={`w-full py-4 rounded-xl font-bold text-base transition-all ${
              status === 'success' 
                ? 'bg-navy text-white shadow-lg active:scale-[0.98]' 
                : 'bg-zinc-200 text-zinc-400 cursor-not-allowed'
            }`}
          >
            Continue
          </button>
          
          <div className="flex items-center gap-1.5 text-zinc-400">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <span className="text-[11px] font-medium uppercase tracking-wider">
              Your file is encrypted and deleted after printing
            </span>
          </div>
        </div>

      </div>
      </div>
    </div>
  )
}
