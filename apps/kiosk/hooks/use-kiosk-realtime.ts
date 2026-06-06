'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@vaultprint/db'

// ---------------------------------------------------------------------------
// useKioskRealtime — Supabase Realtime subscription for kiosk job events
//
// Subscribes to INSERT and UPDATE events on the `print_jobs` table,
// filtered to:
//   - kiosk_id = the current kiosk
//   - status   = 'queued'
//
// When a matching event arrives (a user just paid and their job was queued),
// the hook navigates the kiosk display to the OTP entry screen.
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

          // Only navigate when a job transitions to 'queued' status.
          // This happens when the Mobile App user completes payment and
          // the OTP is generated.
          if (newRecord && newRecord.status === 'queued') {
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
