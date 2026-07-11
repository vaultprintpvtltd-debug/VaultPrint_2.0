'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@vaultprint/db'
import {
  parseKioskConfig,
  DEFAULT_KIOSK_CONFIG,
  type KioskConfig,
} from '@vaultprint/lib/kiosk-config'

// ---------------------------------------------------------------------------
// useKioskConfig — the ONLY place the kiosk app reads kiosks.config.
//
// Fetches the config once, validates it with the Zod schema.
// FAIL-SAFE (PRD C1.3): any fetch or validation failure degrades the kiosk
// to the standard-only config and logs an error — a corrupt config can
// never take a kiosk offline.
// ---------------------------------------------------------------------------

export function useKioskConfig(kioskId: string) {
  const [config, setConfig] = useState<KioskConfig | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchConfig() {
      try {
        const supabase = createBrowserClient()
        const { data, error } = await supabase
          .from('kiosks')
          .select('config')
          .eq('id', kioskId)
          .single()

        if (cancelled) return

        if (error || !data) {
          console.error(
            '[useKioskConfig] Failed to fetch kiosk config — using standard-only fallback:',
            error
          )
          setConfig(DEFAULT_KIOSK_CONFIG)
          return
        }

        // parseKioskConfig is itself fail-safe (returns default on invalid)
        setConfig(parseKioskConfig((data as { config?: unknown }).config))
      } catch (err) {
        if (cancelled) return
        console.error(
          '[useKioskConfig] Unexpected error — using standard-only fallback:',
          err
        )
        setConfig(DEFAULT_KIOSK_CONFIG)
      }
    }

    fetchConfig()
    return () => {
      cancelled = true
    }
  }, [kioskId])

  return {
    config,
    loading: config === null,
  }
}
