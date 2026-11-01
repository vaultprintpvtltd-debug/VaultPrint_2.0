'use client'

import { useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// StaffUnlock — hidden staff exit from the locked kiosk screen.
//
// Press and hold the wrapped element (the VaultPrint logo) for 5 seconds →
// a staff PIN pad. The PIN goes to the print agent on the SAME device
// (127.0.0.1 only — agent.js staff server), which checks it against a hash
// and runs the unlock. The box's navigation bar is hidden in kiosk mode, so
// this is the on-screen way out; maintenance re-locks itself after 30 min.
// ---------------------------------------------------------------------------

const HOLD_MS = 5000
const AGENT_URL = 'http://127.0.0.1:4100/kiosk/unlock'

export function StaffUnlock({ children }: { children: React.ReactNode }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const [pin, setPin] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const startHold = () => {
    timer.current = setTimeout(() => {
      setOpen(true)
      setPin('')
      setMessage(null)
    }, HOLD_MS)
  }
  const cancelHold = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  async function submit(code: string) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(AGENT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: code }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (res.ok) {
        setMessage('Unlocked for maintenance (re-locks automatically after 30 minutes).')
      } else {
        setPin('')
        setMessage(data.error || 'Wrong PIN')
      }
    } catch {
      setPin('')
      setMessage('Print agent not reachable on this device')
    } finally {
      setBusy(false)
    }
  }

  const press = (key: string) => {
    if (busy) return
    if (key === 'del') return setPin((p) => p.slice(0, -1))
    if (key === 'ok') return pin.length >= 4 && submit(pin)
    if (pin.length < 12) setPin((p) => p + key)
  }

  return (
    <>
      <div
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
      >
        {children}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="w-[min(90vw,360px)] rounded-3xl border border-white/10 bg-zinc-900 p-6 text-center shadow-2xl">
            <h2 className="text-lg font-bold text-white">Staff access</h2>
            <p className="mt-1 text-xs text-zinc-400">Enter the staff PIN to unlock this kiosk</p>
            <div className="my-4 h-10 rounded-xl border border-white/10 bg-black/40 text-2xl tracking-[0.4em] text-white leading-10">
              {'•'.repeat(pin.length)}
            </div>
            {message && <p className="mb-3 text-sm text-amber-300">{message}</p>}
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) => (
                <button
                  key={k}
                  onClick={() => press(k)}
                  className="h-12 rounded-xl border border-white/10 bg-white/5 text-lg font-semibold text-white active:bg-white/20"
                >
                  {k === 'del' ? '⌫' : k === 'ok' ? 'OK' : k}
                </button>
              ))}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="mt-4 text-sm text-zinc-400 underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  )
}
