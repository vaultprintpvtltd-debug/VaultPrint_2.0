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
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')
const crypto = require('crypto')

// ─── ENV VALIDATION ─────────────────────────────────────────────────────────

const KIOSK_ID = process.env.KIOSK_ID
const KIOSK_API_KEY = process.env.KIOSK_API_KEY
const KIOSK_API_BASE_URL = process.env.KIOSK_API_BASE_URL
const PRINTER_NAME = process.env.PRINTER_NAME || ''

const HEARTBEAT_INTERVAL_MS = 30 * 1000 // 30 seconds
const POLL_INTERVAL_MS = 3000 // 3 seconds
const PLATFORM = process.platform // 'win32' | 'darwin' | 'linux'

// Keep track of whether we are currently processing a job so we don't overlap
let isProcessingJob = false

function fatal(message) {
  console.error(`[VaultPrint Agent] FATAL: ${message}`)
  process.exit(1)
}

if (!KIOSK_ID) fatal('KIOSK_ID is not set in .env')
if (!KIOSK_API_KEY) fatal('KIOSK_API_KEY is not set in .env')
if (!KIOSK_API_BASE_URL) fatal('KIOSK_API_BASE_URL is not set in .env')

// Startup guard: KIOSK_API_BASE_URL must contain "kiosk." in production.
const isLocalDev = KIOSK_API_BASE_URL.includes('localhost') || KIOSK_API_BASE_URL.includes('127.0.0.1')
if (!isLocalDev && !KIOSK_API_BASE_URL.includes('kiosk.')) {
  fatal(
    `KIOSK_API_BASE_URL must contain "kiosk." — got: ${KIOSK_API_BASE_URL}\n` +
    `  Expected something like: https://kiosk.vaultprintpvtltd.online\n` +
    `  For local development use: http://localhost:3001`
  )
}

// Ensure temp directory exists for downloads
const TEMP_DIR = path.join(__dirname, 'temp')
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true })
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
    // Silent success for heartbeat to not clutter logs, only log on startup
    return true
  } catch (err) {
    logError('Heartbeat network error:', err.message)
    return false
  }
}

// ─── POLLING & EXECUTION ────────────────────────────────────────────────────

async function downloadPdf(url, destPath) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download PDF: ${res.statusText}`)
  
  const buffer = await res.arrayBuffer()
  fs.writeFileSync(destPath, Buffer.from(buffer))
}

function buildPrintCommand(filePath, settings) {
  const copies = settings.copies || 1
  const duplex = settings.duplex ? 'duplex' : 'simplex' // simplified for lp
  const pages = settings.pages_to_print !== 'all' ? settings.pages_to_print : null
  
  // Windows: SumatraPDF
  if (PLATFORM === 'win32') {
    // SumatraPDF requires absolute path
    const sumatraPath = path.resolve(__dirname, 'SumatraPDF.exe')
    if (!fs.existsSync(sumatraPath)) {
      throw new Error(`SumatraPDF.exe not found at ${sumatraPath}. Please download it.`)
    }
    
    // Construct Sumatra settings string
    let sumatraSettings = `${copies}x,${duplex}`
    if (settings.color_mode === 'bw') sumatraSettings += ',monochrome'
    else sumatraSettings += ',color'
    
    if (pages) sumatraSettings += `,${pages}`

    let cmd = `"${sumatraPath}" -print-to "${PRINTER_NAME}" -print-settings "${sumatraSettings}" -silent "${filePath}"`
    return cmd
  }
  
  // macOS / Linux: CUPS lp
  let cmd = `lp -d "${PRINTER_NAME}" -n ${copies}`
  if (settings.color_mode === 'bw') cmd += ' -o ColorModel=Gray'
  if (settings.duplex) cmd += ' -o sides=two-sided-long-edge'
  if (pages) cmd += ` -P ${pages}`
  cmd += ` "${filePath}"`
  return cmd
}

function executePrint(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error)
        return
      }
      resolve(stdout || stderr)
    })
  })
}

async function reportJobStatus(jobId, status, errorMessage = null) {
  try {
    const body = { status }
    if (errorMessage) body.error_message = errorMessage

    const response = await fetch(`${KIOSK_API_BASE_URL}/api/kiosk/${KIOSK_ID}/job/${jobId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KIOSK_API_KEY}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      logError(`Failed to report job status ${status} for ${jobId}`, await response.text())
    } else {
      log(`Reported job ${jobId} as ${status}`)
    }
  } catch (err) {
    logError(`Network error reporting job status for ${jobId}:`, err.message)
  }
}

async function pollQueue() {
  if (isProcessingJob) return

  try {
    const response = await fetch(`${KIOSK_API_BASE_URL}/api/kiosk/${KIOSK_ID}/queue`, {
      headers: {
        'Authorization': `Bearer ${KIOSK_API_KEY}`,
      },
    })

    if (!response.ok) {
      // Don't clutter logs on 404/empty, only on real errors
      if (response.status !== 404) {
        logError(`Poll failed (HTTP ${response.status})`, await response.text())
      }
      return
    }

    const data = await response.json()
    if (!data.job) return // Queue empty

    const job = data.job
    isProcessingJob = true
    log(`---`)
    log(`Picked up job: ${job.id}`)
    log(`Settings: ${job.copies}x, ${job.color_mode}, Duplex: ${job.duplex}, Pages: ${job.pages_to_print}`)

    const tempFileName = `job_${job.id}_${crypto.randomBytes(4).toString('hex')}.pdf`
    const tempFilePath = path.join(TEMP_DIR, tempFileName)

    try {
      // 1. Download
      log(`Downloading PDF...`)
      await downloadPdf(job.file_url, tempFilePath)
      log(`Download complete.`)

      // 2. Print
      if (!PRINTER_NAME) {
        throw new Error('PRINTER_NAME is not set in .env')
      }

      const cmd = buildPrintCommand(tempFilePath, job)
      log(`Executing print: ${cmd}`)
      
      // We wrap execute in a try/catch, but for now we might fake it if no printer
      if (PRINTER_NAME === 'FAKE_PRINTER' || isLocalDev) {
        log(`[DEV MODE] Simulating print for 3 seconds...`)
        await new Promise(r => setTimeout(r, 3000))
      } else {
        await executePrint(cmd)
      }
      
      log(`Print spooled successfully.`)

      // 3. Report Success
      await reportJobStatus(job.id, 'completed')

    } catch (jobErr) {
      logError(`Job execution failed:`, jobErr.message)
      await reportJobStatus(job.id, 'failed', jobErr.message)
    } finally {
      // Cleanup temp file
      if (fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath) } catch (e) { /* ignore */ }
      }
      log(`---`)
      isProcessingJob = false
    }

  } catch (err) {
    logError('Poll network error:', err.message)
    isProcessingJob = false
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

  // Start queue polling loop
  log(`Starting queue polling (every ${POLL_INTERVAL_MS / 1000}s)...`)
  setInterval(pollQueue, POLL_INTERVAL_MS)

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
