// ---------------------------------------------------------------------------
// VaultPrint Print Agent
//
// Standalone Node.js process that runs on each kiosk PC.
// Managed by pm2 via ecosystem.config.js.
//
// Responsibilities:
//   1. Heartbeat — POST /api/kiosk/heartbeat every 30s
//   2. Queue polling — GET /api/kiosk/[id]/queue every 3s (Phase 3)
//   3. Print execution — SumatraPDF (Windows) or lp (macOS/Linux) (Phase 3)
//   4. Job completion — PATCH /api/kiosk/[id]/job/[jid] (Phase 3)
// ---------------------------------------------------------------------------

require('dotenv').config()
const os = require('os')

// ─── ENV VALIDATION ─────────────────────────────────────────────────────────

const KIOSK_ID = process.env.KIOSK_ID
const KIOSK_API_KEY = process.env.KIOSK_API_KEY
const KIOSK_API_BASE_URL = process.env.KIOSK_API_BASE_URL
const PRINTER_NAME = process.env.PRINTER_NAME || ''

const HEARTBEAT_INTERVAL_MS = 30 * 1000 // 30 seconds
const PLATFORM = process.platform // 'win32' | 'darwin' | 'linux'

function fatal(message) {
  console.error(`[VaultPrint Agent] FATAL: ${message}`)
  process.exit(1)
}

if (!KIOSK_ID) fatal('KIOSK_ID is not set in .env')
if (!KIOSK_API_KEY) fatal('KIOSK_API_KEY is not set in .env')
if (!KIOSK_API_BASE_URL) fatal('KIOSK_API_BASE_URL is not set in .env')

// Startup guard: KIOSK_API_BASE_URL must contain "kiosk." in production.
// Allow localhost for local development.
const isLocalDev = KIOSK_API_BASE_URL.includes('localhost') || KIOSK_API_BASE_URL.includes('127.0.0.1')
if (!isLocalDev && !KIOSK_API_BASE_URL.includes('kiosk.')) {
  fatal(
    `KIOSK_API_BASE_URL must contain "kiosk." — got: ${KIOSK_API_BASE_URL}\n` +
    `  Expected something like: https://kiosk.vaultprintpvtltd.online\n` +
    `  For local development use: http://localhost:3001`
  )
}

// ─── LOGGING ────────────────────────────────────────────────────────────────

function log(message) {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] [VaultPrint Agent] ${message}`)
}

function logError(message, err) {
  const timestamp = new Date().toISOString()
  console.error(`[${timestamp}] [VaultPrint Agent] ERROR: ${message}`, err || '')
}

// ─── HEARTBEAT ──────────────────────────────────────────────────────────────

async function sendHeartbeat() {
  try {
    const response = await fetch(`${KIOSK_API_BASE_URL}/api/kiosk/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KIOSK_API_KEY}`,
      },
      body: JSON.stringify({
        os_platform: PLATFORM,
        printer_name: PRINTER_NAME,
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      logError(`Heartbeat failed (HTTP ${response.status}): ${errorBody}`)
      return false
    }

    const data = await response.json()
    log(`Heartbeat OK → kiosk_id: ${data.kiosk_id}`)
    return true
  } catch (err) {
    logError('Heartbeat network error:', err.message)
    return false
  }
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('')
  console.log('╔═══════════════════════════════════════════════════════════╗')
  console.log('║              VaultPrint Print Agent v1.0                  ║')
  console.log('╚═══════════════════════════════════════════════════════════╝')
  console.log('')
  log(`Platform:    ${PLATFORM} (${os.type()} ${os.release()})`)
  log(`Kiosk ID:    ${KIOSK_ID}`)
  log(`API Base:    ${KIOSK_API_BASE_URL}`)
  log(`Printer:     ${PRINTER_NAME || '(not configured)'}`)
  log(`Hostname:    ${os.hostname()}`)
  console.log('')

  // Send initial heartbeat immediately
  log('Sending initial heartbeat...')
  const firstHeartbeat = await sendHeartbeat()

  if (firstHeartbeat) {
    log('✓ Agent connected successfully. Kiosk is now online.')
  } else {
    log('⚠ Initial heartbeat failed. Will retry in 30s. Check your API key and network.')
  }

  // Start heartbeat loop
  log(`Starting heartbeat loop (every ${HEARTBEAT_INTERVAL_MS / 1000}s)...`)
  setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)

  // TODO: Phase 3 — Start queue polling loop
  // setInterval(pollQueue, 3000)

  log('Agent is running. Press Ctrl+C to stop.')
}

// ─── GRACEFUL SHUTDOWN ──────────────────────────────────────────────────────

process.on('SIGINT', () => {
  log('Received SIGINT. Shutting down gracefully...')
  process.exit(0)
})

process.on('SIGTERM', () => {
  log('Received SIGTERM. Shutting down gracefully...')
  process.exit(0)
})

process.on('uncaughtException', (err) => {
  logError('Uncaught exception:', err)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  logError('Unhandled rejection:', reason)
  process.exit(1)
})

// Start
main()
