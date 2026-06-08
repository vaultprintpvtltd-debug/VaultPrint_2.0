'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

// ---------------------------------------------------------------------------
// /kiosk/[kioskId]/success — Print confirmed, auto-return to idle screen
// ---------------------------------------------------------------------------

export default function SuccessPage() {
  const params = useParams<{ kioskId: string }>()
  const router = useRouter()
  const [countdown, setCountdown] = useState(5)

  // Auto-return to kiosk idle screen after 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(interval)
          router.push(`/kiosk/${params.kioskId}`)
          return 0
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [params.kioskId, router])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 text-zinc-100 p-8">
      {/* Checkmark */}
      <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-emerald-500/20">
        <svg className="h-12 w-12 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <h1 className="mb-2 text-3xl font-bold">Code Verified!</h1>
      <p className="mb-1 text-zinc-400">Your document is being sent to the printer.</p>
      <p className="text-zinc-500 text-sm">Please wait while it prints.</p>

      {/* Print summary */}
      <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
        <p className="font-bold text-zinc-200">Print Summary</p>
        <ul className="mt-2 space-y-1">
          <li>• Status: Printing</li>
          <li>• Configuration: B&W, Duplex</li>
        </ul>
      </div>

      <div className="mt-8 text-sm text-zinc-500">
        Returning to home in {countdown}s...
      </div>
    </div>
  )
}
