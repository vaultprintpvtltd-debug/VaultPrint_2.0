import { z } from 'zod'

// ---------------------------------------------------------------------------
// Kiosk Configuration Layer — PRD C1
//
// The single source of truth for the shape of `kiosks.config`.
// Used in exactly two places:
//   1. useKioskConfig() (kiosk app) — FAIL-SAFE read: a corrupt config
//      degrades the kiosk to standard-only, never takes it offline.
//   2. PATCH /api/admin/kiosks/[id]/config — rejects invalid configs with
//      field-level errors.
//
// Invariants enforced here (PRD D5):
//   - Standard mode is ALWAYS present and enabled (refine below).
//   - Unknown keys are rejected (.strict()).
//   - OTP security parameters are NOT configurable — only whether the OTP
//     is displayed (otp_display), never its strength/expiry/attempts.
// ---------------------------------------------------------------------------

// ─── Mode schemas ────────────────────────────────────────────────────────────

export const StandardModeSchema = z
  .object({
    id: z.literal('standard'),
    label: z.string().min(1).max(40),
    enabled: z.boolean(),
  })
  .strict()

export const SchoolOfflineModeSchema = z
  .object({
    id: z.literal('school_offline'),
    label: z.string().min(1).max(40),
    enabled: z.boolean(),
    client: z
      .object({
        name: z.string().min(1).max(80),
        short_name: z.string().min(1).max(20),
        logo_url: z.string().url().optional(),
        accent_color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex colour like #1A3C5E')
          .optional(),
      })
      .strict(),
    payment: z
      .object({
        method: z.literal('pos'),
        currency: z.literal('INR'),
        pos_confirm_mode: z.enum(['manual', 'callback']).default('manual'),
        require_receipt_ref: z.boolean().default(true),
      })
      .strict(),
    file_source: z.literal('local_hotspot_upload'),
    hotspot: z
      .object({
        ssid: z.string().min(1).max(32),
        // Android hotspot requirement: WPA2 passwords are >= 8 chars
        password: z.string().min(8).max(63),
        receiver_port: z.number().int().min(1024).max(65535).default(4000),
        gateway_ip: z
          .string()
          .regex(/^(\d{1,3}\.){3}\d{1,3}$/, 'Must be an IPv4 address')
          .default('192.168.43.1'),
      })
      .strict(),
    otp_display: z.enum(['skip', 'show']).default('skip'),
    session_timeout_minutes: z.number().int().min(5).max(30).default(10),
  })
  .strict()

export const KioskModeSchema = z.discriminatedUnion('id', [
  StandardModeSchema,
  SchoolOfflineModeSchema,
])

export const KioskConfigSchema = z
  .object({
    modes: z.array(KioskModeSchema).min(1),
  })
  .strict()
  .refine(
    (config) =>
      config.modes.some((m) => m.id === 'standard' && m.enabled === true),
    {
      message:
        'Standard mode must always be present and enabled — the core product cannot be disabled.',
      path: ['modes'],
    }
  )
  .refine(
    (config) => {
      const ids = config.modes.map((m) => m.id)
      return new Set(ids).size === ids.length
    },
    { message: 'Duplicate mode ids are not allowed.', path: ['modes'] }
  )

// ─── Types ───────────────────────────────────────────────────────────────────

export type StandardMode = z.infer<typeof StandardModeSchema>
export type SchoolOfflineMode = z.infer<typeof SchoolOfflineModeSchema>
export type KioskMode = z.infer<typeof KioskModeSchema>
export type KioskConfig = z.infer<typeof KioskConfigSchema>

// ─── Defaults & helpers ──────────────────────────────────────────────────────

/** The fail-safe config: standard mode only. */
export const DEFAULT_KIOSK_CONFIG: KioskConfig = {
  modes: [{ id: 'standard', label: 'Print', enabled: true }],
}

/**
 * Parse an unknown config value (e.g. the kiosks.config JSONB column).
 *
 * FAIL-SAFE: if validation fails, returns the standard-only default and
 * logs the error. A corrupt config degrades a kiosk to standard mode —
 * it can never take it offline (PRD C1.3 / risk R17).
 */
export function parseKioskConfig(raw: unknown): KioskConfig {
  const result = KioskConfigSchema.safeParse(raw)
  if (result.success) return result.data
  console.error(
    '[kiosk-config] Invalid kiosk config — falling back to standard-only mode:',
    result.error.issues
  )
  return DEFAULT_KIOSK_CONFIG
}

/** All enabled modes, in config order. */
export function getEnabledModes(config: KioskConfig): KioskMode[] {
  return config.modes.filter((m) => m.enabled)
}

/** Find a mode by id (enabled or not). */
export function getModeById(
  config: KioskConfig,
  id: KioskMode['id']
): KioskMode | undefined {
  return config.modes.find((m) => m.id === id)
}

/** Convenience: the school_offline mode if present AND enabled. */
export function getSchoolOfflineMode(
  config: KioskConfig
): SchoolOfflineMode | undefined {
  const mode = config.modes.find(
    (m): m is SchoolOfflineMode => m.id === 'school_offline' && m.enabled
  )
  return mode
}
