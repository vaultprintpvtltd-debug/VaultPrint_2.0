'use client'

import { useParams } from 'next/navigation'

// ---------------------------------------------------------------------------
// /done/[sessionId] — Print Complete Page
// ---------------------------------------------------------------------------

export default function DonePage() {
  const params = useParams<{ sessionId: string }>()

  return (
    <div className="flex flex-col flex-1 w-full max-w-lg mx-auto items-center justify-center">
      <div className="w-full flex flex-col items-center text-center bg-white/40 backdrop-blur-2xl border border-white/60 shadow-[0_8px_32px_0_rgba(31,38,135,0.05)] rounded-[2rem] p-8 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/30 to-transparent pointer-events-none rounded-t-[2rem]"></div>
        <div className="relative z-10 mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/15">
          <svg className="h-10 w-10 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="relative z-10 text-2xl font-black text-navy">Print complete!</h1>
        <p className="relative z-10 mt-2 text-sm font-semibold text-zinc-500">
          Your document has been printed. Please collect it from the kiosk tray.
        </p>
        <p className="relative z-10 mt-6 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
          Session {params.sessionId?.slice(0, 8)}
        </p>
      </div>
    </div>
  )
}
