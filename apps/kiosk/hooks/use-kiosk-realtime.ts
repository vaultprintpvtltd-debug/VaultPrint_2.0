'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@vaultprint/db'

// ---------------------------------------------------------------------------
// useKioskRealtime — Supabase Realtime subscription for kiosk job events
//
// Subscribes to INSERT and UPDATE events on the `print_jobs` table for the
// current kiosk. When a Mode 1 job becomes 'paid' (a customer just paid on
// their phone) the idle screen navigates to the OTP entry screen.
//
// Realtime payloads only carry the columns anon may SELECT (migration 007).
// ---------------------------------------------------------------------------

export function useKioskRealtime(kioskId: string) {
  const router = useRouter()
  const supabaseRef = useRef(createBrowserClient())

  useEffect(() => {
    const supabase = supabaseRef.current

    const channel = supabase
      .channel(`kiosk-${kioskId}-jobs`)
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

          // Mode 2 (POS) jobs are driven by their own screens/hook — the
          // Mode 1 navigation below must never react to them.
          if (newRecord && newRecord.payment_mode === 'pos') return

          // A customer just paid → bring up the code pad. Nothing else
          // navigates from the idle screen: other customers' sessions must
          // never hijack the shared display.
          if (newRecord && newRecord.status === 'paid') {
            router.push(`/kiosk/${kioskId}/enter-otp`)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [kioskId, router])
}
