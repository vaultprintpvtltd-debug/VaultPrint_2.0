'use client'

import { useParams } from 'next/navigation'

// ---------------------------------------------------------------------------
// /done/[sessionId] — Print Complete Page
// ---------------------------------------------------------------------------

export default function DonePage() {
  const params = useParams<{ sessionId: string }>()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 text-zinc-100 p-6">
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/20">
        <svg className="h-10 w-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h1 className="text-2xl font-bold">Print Complete!</h1>
      <p className="mt-2 text-zinc-400 text-center">
        Your document has been printed. Please collect it from the kiosk.
      </p>
      <p className="mt-6 text-xs text-zinc-600">Session: {params.sessionId?.slice(0, 8)}...</p>
    </div>
  )
}
