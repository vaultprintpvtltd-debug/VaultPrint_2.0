'use client'

import { useEffect, useState, useCallback } from 'react'

// ---------------------------------------------------------------------------
// KioskConfigEditor — structured form for a kiosk's config JSONB (PRD C1).
//
// Generates the config object from form fields (never raw JSON editing).
// Standard mode is always present and enabled — the toggle is locked.
// Server-side Zod validation errors are surfaced per field path.
// ---------------------------------------------------------------------------

interface SchoolFormState {
  enabled: boolean
  label: string
  client_name: string
  client_short_name: string
  logo_url: string
  accent_color: string
  pos_confirm_mode: 'manual' | 'callback'
  require_receipt_ref: boolean
  hotspot_ssid: string
  hotspot_password: string
  receiver_port: string
  gateway_ip: string
  otp_display: 'skip' | 'show'
  session_timeout_minutes: string
}

const DEFAULT_SCHOOL_FORM: SchoolFormState = {
  enabled: false,
  label: 'Student Upload',
  client_name: '',
  client_short_name: '',
  logo_url: '',
  accent_color: '',
  pos_confirm_mode: 'manual',
  require_receipt_ref: true,
  hotspot_ssid: '',
  hotspot_password: '',
  receiver_port: '4000',
  gateway_ip: '192.168.43.1',
  otp_display: 'skip',
  session_timeout_minutes: '10',
}

interface Props {
  kioskId: string
  kioskName: string
  onClose: () => void
}

export function KioskConfigEditor({ kioskId, kioskName, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [issues, setIssues] = useState<{ path: string; message: string }[]>([])
  const [saved, setSaved] = useState(false)

  const [standardLabel, setStandardLabel] = useState('Print')
  const [school, setSchool] = useState<SchoolFormState>(DEFAULT_SCHOOL_FORM)

  // ── Load current config ────────────────────────────────────────────────
  const loadConfig = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(`/api/admin/kiosks/${kioskId}/config`)
      if (!res.ok) throw new Error('Failed to load config')
      const data = await res.json()
      const modes: Record<string, unknown>[] = data.config?.modes ?? []

      const std = modes.find((m) => m.id === 'standard')
      if (std && typeof std.label === 'string') setStandardLabel(std.label)

      const sch = modes.find((m) => m.id === 'school_offline') as
        | Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
        | undefined
      if (sch) {
        setSchool({
          enabled: Boolean(sch.enabled),
          label: sch.label ?? 'Student Upload',
          client_name: sch.client?.name ?? '',
          client_short_name: sch.client?.short_name ?? '',
          logo_url: sch.client?.logo_url ?? '',
          accent_color: sch.client?.accent_color ?? '',
          pos_confirm_mode: sch.payment?.pos_confirm_mode ?? 'manual',
          require_receipt_ref: sch.payment?.require_receipt_ref ?? true,
          hotspot_ssid: sch.hotspot?.ssid ?? '',
          hotspot_password: sch.hotspot?.password ?? '',
          receiver_port: String(sch.hotspot?.receiver_port ?? 4000),
          gateway_ip: sch.hotspot?.gateway_ip ?? '192.168.43.1',
          otp_display: sch.otp_display ?? 'skip',
          session_timeout_minutes: String(sch.session_timeout_minutes ?? 10),
        })
      } else {
        setSchool(DEFAULT_SCHOOL_FORM)
      }
      setLoading(false)
    } catch {
      setLoadError('Failed to load kiosk config.')
      setLoading(false)
    }
  }, [kioskId])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // ── Build the config object from form state ────────────────────────────
  function buildConfig() {
    const modes: unknown[] = [
      // Standard mode: ALWAYS present and enabled (PRD invariant)
      { id: 'standard', label: standardLabel || 'Print', enabled: true },
    ]

    // Include school_offline whenever any of its fields have been filled in,
    // so a temporarily disabled client keeps its configuration.
    if (school.enabled || school.client_name || school.hotspot_ssid) {
      modes.push({
        id: 'school_offline',
        label: school.label || 'Student Upload',
        enabled: school.enabled,
        client: {
          name: school.client_name,
          short_name: school.client_short_name,
          ...(school.logo_url ? { logo_url: school.logo_url } : {}),
          ...(school.accent_color ? { accent_color: school.accent_color } : {}),
        },
        payment: {
          method: 'pos',
          currency: 'INR',
          pos_confirm_mode: school.pos_confirm_mode,
          require_receipt_ref: school.require_receipt_ref,
        },
        file_source: 'local_hotspot_upload',
        hotspot: {
          ssid: school.hotspot_ssid,
          password: school.hotspot_password,
          receiver_port: parseInt(school.receiver_port, 10) || 0,
          gateway_ip: school.gateway_ip,
        },
        otp_display: school.otp_display,
        session_timeout_minutes:
          parseInt(school.session_timeout_minutes, 10) || 0,
      })
    }

    return { modes }
  }

  // ── Save ───────────────────────────────────────────────────────────────
  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)
    setIssues([])
    setSaved(false)

    try {
      const res = await fetch(`/api/admin/kiosks/${kioskId}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: buildConfig() }),
      })

      const data = await res.json()

      if (!res.ok) {
        setSaveError(data.error || 'Failed to save config')
        if (Array.isArray(data.issues)) setIssues(data.issues)
        setSaving(false)
        return
      }

      setSaved(true)
      setSaving(false)
    } catch {
      setSaveError('An unexpected error occurred.')
      setSaving(false)
    }
  }

  const fieldIssue = (prefix: string) =>
    issues.find((i) => i.path.includes(prefix))?.message

  const inputCls =
    'w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30'
  const labelCls = 'mb-1 block text-xs font-medium text-zinc-400'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-6 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-zinc-100">Kiosk Configuration</h3>
            <p className="mt-0.5 text-sm text-zinc-500">{kioskName}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-700 border-t-emerald-500" />
          </div>
        ) : loadError ? (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {loadError}
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-6">
            {/* ── Standard mode ─────────────────────────────────────── */}
            <fieldset className="rounded-xl border border-zinc-800 p-4">
              <legend className="px-2 text-sm font-semibold text-emerald-400">
                Standard Mode (always enabled)
              </legend>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Button label</label>
                  <input
                    type="text"
                    value={standardLabel}
                    onChange={(e) => setStandardLabel(e.target.value)}
                    className={inputCls}
                    required
                  />
                </div>
                <div className="flex items-end pb-2 text-xs text-zinc-500">
                  The core Mode 1 flow cannot be disabled.
                </div>
              </div>
            </fieldset>

            {/* ── School offline mode ───────────────────────────────── */}
            <fieldset className="rounded-xl border border-zinc-800 p-4">
              <legend className="px-2 text-sm font-semibold text-sky-400">
                School Offline Mode (Mode 2)
              </legend>

              <label className="mb-4 flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={school.enabled}
                  onChange={(e) =>
                    setSchool({ ...school, enabled: e.target.checked })
                  }
                  className="h-4 w-4 accent-sky-500"
                />
                Enable Student Upload for this kiosk
              </label>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Button label</label>
                  <input
                    type="text"
                    value={school.label}
                    onChange={(e) => setSchool({ ...school, label: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Client name</label>
                  <input
                    type="text"
                    value={school.client_name}
                    onChange={(e) => setSchool({ ...school, client_name: e.target.value })}
                    placeholder="BIT Mesra"
                    className={inputCls}
                  />
                  {fieldIssue('client.name') && (
                    <p className="mt-1 text-xs text-red-400">{fieldIssue('client.name')}</p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Client short name</label>
                  <input
                    type="text"
                    value={school.client_short_name}
                    onChange={(e) => setSchool({ ...school, client_short_name: e.target.value })}
                    placeholder="BIT"
                    className={inputCls}
                  />
                  {fieldIssue('client.short_name') && (
                    <p className="mt-1 text-xs text-red-400">{fieldIssue('client.short_name')}</p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Logo URL (optional)</label>
                  <input
                    type="text"
                    value={school.logo_url}
                    onChange={(e) => setSchool({ ...school, logo_url: e.target.value })}
                    placeholder="https://…"
                    className={inputCls}
                  />
                  {fieldIssue('logo_url') && (
                    <p className="mt-1 text-xs text-red-400">{fieldIssue('logo_url')}</p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Accent colour (optional)</label>
                  <input
                    type="text"
                    value={school.accent_color}
                    onChange={(e) => setSchool({ ...school, accent_color: e.target.value })}
                    placeholder="#1A3C5E"
                    className={inputCls}
                  />
                  {fieldIssue('accent_color') && (
                    <p className="mt-1 text-xs text-red-400">{fieldIssue('accent_color')}</p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Hotspot SSID</label>
                  <input
                    type="text"
                    value={school.hotspot_ssid}
                    onChange={(e) => setSchool({ ...school, hotspot_ssid: e.target.value })}
                    placeholder="VaultPrint-BIT"
                    className={inputCls}
                  />
                  {fieldIssue('hotspot.ssid') && (
                    <p className="mt-1 text-xs text-red-400">{fieldIssue('hotspot.ssid')}</p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Hotspot password (min 8 chars)</label>
                  <input
                    type="text"
                    value={school.hotspot_password}
                    onChange={(e) => setSchool({ ...school, hotspot_password: e.target.value })}
                    className={inputCls}
                  />
                  {fieldIssue('hotspot.password') && (
                    <p className="mt-1 text-xs text-red-400">{fieldIssue('hotspot.password')}</p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Receiver port (1024–65535)</label>
                  <input
                    type="number"
                    value={school.receiver_port}
                    onChange={(e) => setSchool({ ...school, receiver_port: e.target.value })}
                    className={inputCls}
                  />
                  {fieldIssue('receiver_port') && (
                    <p className="mt-1 text-xs text-red-400">{fieldIssue('receiver_port')}</p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Hotspot gateway IP</label>
                  <input
                    type="text"
                    value={school.gateway_ip}
                    onChange={(e) => setSchool({ ...school, gateway_ip: e.target.value })}
                    className={inputCls}
                  />
                  {fieldIssue('gateway_ip') && (
                    <p className="mt-1 text-xs text-red-400">{fieldIssue('gateway_ip')}</p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>POS confirm mode</label>
                  <select
                    value={school.pos_confirm_mode}
                    onChange={(e) =>
                      setSchool({ ...school, pos_confirm_mode: e.target.value as 'manual' | 'callback' })
                    }
                    className={inputCls}
                  >
                    <option value="manual">Manual (receipt ref)</option>
                    <option value="callback">Callback (POS terminal)</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>OTP display</label>
                  <select
                    value={school.otp_display}
                    onChange={(e) =>
                      setSchool({ ...school, otp_display: e.target.value as 'skip' | 'show' })
                    }
                    className={inputCls}
                  >
                    <option value="skip">Skip (default — no gap at kiosk)</option>
                    <option value="show">Show OTP + numpad</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Session timeout (5–30 min)</label>
                  <input
                    type="number"
                    value={school.session_timeout_minutes}
                    onChange={(e) => setSchool({ ...school, session_timeout_minutes: e.target.value })}
                    className={inputCls}
                  />
                  {fieldIssue('session_timeout_minutes') && (
                    <p className="mt-1 text-xs text-red-400">{fieldIssue('session_timeout_minutes')}</p>
                  )}
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={school.require_receipt_ref}
                      onChange={(e) =>
                        setSchool({ ...school, require_receipt_ref: e.target.checked })
                      }
                      className="h-4 w-4 accent-sky-500"
                    />
                    Require POS receipt ref
                  </label>
                </div>
              </div>
            </fieldset>

            {/* ── Errors / success ──────────────────────────────────── */}
            {saveError && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                <p className="font-medium">{saveError}</p>
                {issues.length > 0 && (
                  <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs">
                    {issues.map((i, idx) => (
                      <li key={idx}>
                        <code className="text-red-300">{i.path}</code>: {i.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {saved && (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
                Config saved. The kiosk picks it up on its next idle-page load.
              </div>
            )}

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2.5 text-sm text-zinc-400 transition hover:text-zinc-100"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Config'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
