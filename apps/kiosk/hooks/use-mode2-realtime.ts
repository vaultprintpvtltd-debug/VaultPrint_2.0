'use client'

import { useEffect, useRef } from 'react'
import { createBrowserClient } from '@vaultprint/db'

// ---------------------------------------------------------------------------
// useMode2Realtime — Supabase Realtime for Mode 2 (POS) jobs only.
//
// Same mechanism as Mode 1 (postgres_changes on print_jobs, no polling),
// but scoped to payment_mode='pos' events for this kiosk. The Mode 1 hook
// (use-kiosk-realtime) explicitly ignores POS jobs — the two never overlap.
// ---------------------------------------------------------------------------

export function useMode2Realtime(
  kioskId: string,
  onJob: (job: Record<string, unknown>) => void
) {
  const supabaseRef = useRef(createBrowserClient())
  const onJobRef = useRef(onJob)
  onJobRef.current = onJob

  useEffect(() => {
    const supabase = supabaseRef.current

    const channel = supabase
      .channel(`kiosk-${kioskId}-mode2-jobs`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'print_jobs',
          filter: `kiosk_id=eq.${kioskId}`,
        },
        (payload) => {
          const newRecord = payload.new as Record<string, unknown> | undefined
          if (newRecord && newRecord.payment_mode === 'pos') {
            onJobRef.current(newRecord)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [kioskId])
}
