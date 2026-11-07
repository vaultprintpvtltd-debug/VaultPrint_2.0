// ---------------------------------------------------------------------------
// VaultPrint Print Agent
//
// Standalone Node.js process that runs on each kiosk device.
// Managed by pm2 via ecosystem.config.js.
//
// Responsibilities:
//   1. Heartbeat — POST /api/kiosk/heartbeat every 30s (+ printer state)
//   2. Queue polling — GET /api/kiosk/[id]/queue every 3s (atomic claim)
//   3. Print execution — backend chosen by PRINT_BACKEND:
//        zjs-usb        Android/Termux + HP LaserJet 1020 (printers/zjs-usb.js)
//        gutenprint-usb Android/Termux + Canon PIXMA G2010 (printers/gutenprint-usb.js)
//        sumatra  Windows, SumatraPDF to an installed Windows printer
//        fake     development only — explicit opt-in, never automatic
//   4. Job completion — PATCH /api/kiosk/[id]/job/[jid] with evidence
//   5. Crash safety — a local journal records how far each job got, so an
//      interrupted job is reported precisely and never silently reprinted
//   6. Kiosk screen lock (Android) — re-pins the kiosk screen if anything
//      unpins it (android/kiosk.sh ensure), unless staff maintenance is on
//   7. Staff unlock (Android) — 127.0.0.1:4100, PIN-checked; the kiosk page's
//      hidden "hold the logo" gesture calls it to enter maintenance mode
// ---------------------------------------------------------------------------

require('dotenv').config()
const fs = require('fs')
const os = require('os')
const path = require('path')
const { exec, execFile } = require('child_process')
const crypto = require('crypto')
const http = require('http')
const { ZjsUsbPrinter, PrinterError } = require('./printers/zjs-usb')
const { GutenprintUsbPrinter } = require('./printers/gutenprint-usb')

// ─── ENV VALIDATION ─────────────────────────────────────────────────────────

const KIOSK_ID = process.env.KIOSK_ID
const KIOSK_API_KEY = process.env.KIOSK_API_KEY
const KIOSK_API_BASE_URL = process.env.KIOSK_API_BASE_URL
const PRINTER_NAME = process.env.PRINTER_NAME || ''

const HEARTBEAT_INTERVAL_MS = 30 * 1000 // 30 seconds
const POLL_INTERVAL_MS = 3000 // 3 seconds
const KIOSK_LOCK_INTERVAL_MS = 10 * 1000 // 10 seconds
const STAFF_PORT = 4100
const STAFF_PIN_SHA256 = (process.env.STAFF_PIN_SHA256 || '').toLowerCase()
const PLATFORM = process.platform // 'win32' | 'darwin' | 'linux' | 'android'

function defaultBackend() {
  if (PRINTER_NAME === 'FAKE_PRINTER') return 'fake'
  if (PLATFORM === 'android') return 'zjs-usb'
  if (PLATFORM === 'win32') return 'sumatra'
  return 'none'
}
const PRINT_BACKEND = process.env.PRINT_BACKEND || defaultBackend()

// Keep track of whether we are currently processing a job so we don't overlap
let isProcessingJob = false
let isPolling = false

function fatal(message) {
  console.error(`[VaultPrint Agent] FATAL: ${message}`)
  process.exit(1)
}

if (!KIOSK_ID) fatal('KIOSK_ID is not set in .env')
if (!KIOSK_API_KEY) fatal('KIOSK_API_KEY is not set in .env')
if (!KIOSK_API_BASE_URL) fatal('KIOSK_API_BASE_URL is not set in .env')
const USB_BACKENDS = ['zjs-usb', 'gutenprint-usb']
if (![...USB_BACKENDS, 'sumatra', 'fake'].includes(PRINT_BACKEND)) {
  fatal(`No print backend for platform "${PLATFORM}". Set PRINT_BACKEND=zjs-usb|gutenprint-usb|sumatra|fake`)
}

// Startup guard: KIOSK_API_BASE_URL must contain "kiosk." in production.
const isLocalDev = KIOSK_API_BASE_URL.includes('localhost') || KIOSK_API_BASE_URL.includes('127.0.0.1')
if (!isLocalDev && !KIOSK_API_BASE_URL.includes('kiosk.')) {
  fatal(
    `KIOSK_API_BASE_URL must contain "kiosk." — got: ${KIOSK_API_BASE_URL}\n` +
    `  Expected something like: https://kiosk.vaultprintpvtltd.online\n` +
    `  For local development use: http://localhost:3001`
  )
}

// Temp directory for downloads — emptied at startup (customer files never
// outlive the job that needed them)
const TEMP_DIR = path.join(__dirname, 'temp')
fs.rmSync(TEMP_DIR, { recursive: true, force: true })
fs.mkdirSync(TEMP_DIR, { recursive: true })

const VP_BIN_DIR = process.env.VP_BIN_DIR || path.join(os.homedir(), 'vaultprint', 'bin')
function createPrinter() {
  if (PRINT_BACKEND === 'zjs-usb') {
    return new ZjsUsbPrinter({
      binDir: VP_BIN_DIR,
      firmwarePath: process.env.VP_FIRMWARE || path.join(os.homedir(), 'vaultprint', 'firmware', 'hp_laserjet_1020.fw'),
      device: process.env.PRINTER_USB_ID || '03f0:2b17',
    })
  }
  if (PRINT_BACKEND === 'gutenprint-usb') {
    return new GutenprintUsbPrinter({
      binDir: VP_BIN_DIR,
      device: process.env.PRINTER_USB_ID || '04a9:183a',
      driver: process.env.GUTENPRINT_DRIVER || 'bjc-G2000-series',
    })
  }
  return null
}
const printer = createPrinter()

// ─── LOGGING ────────────────────────────────────────────────────────────────

function log(message) {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] [VaultPrint Agent] ${message}`)
}

function logError(message, err) {
  const timestamp = new Date().toISOString()
  console.error(`[${timestamp}] [VaultPrint Agent] ERROR: ${message}`, err || '')
}

// ─── JOB JOURNAL ────────────────────────────────────────────────────────────
// { [jobId]: { stage, bytes_sent, updated_at } } — written atomically.
// Stages: claimed → rendering → sending → sent. Removed once the server has
// the final status.

const STATE_DIR = path.join(__dirname, 'state')
const JOURNAL_PATH = path.join(STATE_DIR, 'journal.json')
fs.mkdirSync(STATE_DIR, { recursive: true })

function readJournal() {
  try {
    return JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function writeJournal(journal) {
  const tmp = `${JOURNAL_PATH}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(journal, null, 2))
  fs.renameSync(tmp, JOURNAL_PATH)
}

function journalSet(jobId, stage, extra = {}) {
  const journal = readJournal()
  journal[jobId] = { ...journal[jobId], stage, ...extra, updated_at: new Date().toISOString() }
  writeJournal(journal)
}

function journalDelete(jobId) {
  const journal = readJournal()
  delete journal[jobId]
  writeJournal(journal)
}

// ─── HEARTBEAT ──────────────────────────────────────────────────────────────

/**
 * Mode 2 (Android/Termux) kiosks: detect whether the WiFi hotspot is up by
 * looking for an AP network interface (ap0 / swlan0 / wlan1) with an IPv4
 * address. No-op (undefined) on every other platform, so standard kiosks'
 * heartbeat payload is unchanged.
 */
function detectHotspotActive() {
  if (PLATFORM !== 'android') return undefined
  try {
    const interfaces = os.networkInterfaces()
    const apNames = Object.keys(interfaces).filter((name) =>
      /^(ap\d*|swlan\d*|wlan1)$/.test(name)
    )
    return apNames.some((name) =>
      (interfaces[name] || []).some((addr) => addr.family === 'IPv4' && !addr.internal)
    )
  } catch {
    return undefined
  }
}

/** Printer state for the heartbeat. Never probes the USB while printing. */
async function printerHeartbeatState() {
  if (!printer) return undefined
  const state = isProcessingJob ? printer.lastStatus : await printer.probe()
  if (!state) return undefined
  return {
    present: !!state.present,
    firmware_loaded: !!state.firmware_loaded,
    ready: isProcessingJob ? true : !!state.ready, // busy printing ≠ not ready
    paper_empty: !!state.paper_empty,
    error: !!state.error,
    busy: isProcessingJob,
  }
}

async function sendHeartbeat() {
  try {
    const hotspotActive = detectHotspotActive()
    const printerState = await printerHeartbeatState().catch(() => undefined)
    const response = await fetch(`${KIOSK_API_BASE_URL}/api/kiosk/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KIOSK_API_KEY}`,
      },
      body: JSON.stringify({
        os_platform: PLATFORM,
        printer_name: PRINTER_NAME,
        ...(hotspotActive !== undefined ? { hotspot_active: hotspotActive } : {}),
        ...(printerState ? { printer: printerState } : {}),
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      logError(`Heartbeat failed (HTTP ${response.status}): ${errorBody}`)
      return false
    }

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

function buildSumatraCommand(filePath, settings) {
  const copies = settings.copies || 1
  const duplex = settings.duplex ? 'duplex' : 'simplex'
  const pages = settings.pages_to_print !== 'all' ? settings.pages_to_print : null

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

  return `"${sumatraPath}" -print-to "${PRINTER_NAME}" -print-settings "${sumatraSettings}" -silent "${filePath}"`
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

/**
 * Report a final status. Retries on network errors — a lost "completed"
 * would otherwise leave the job stuck in 'printing'. Returns true once the
 * server has it (or rejects it as already final).
 */
async function reportJobStatus(jobId, status, errorMessage = null, evidence = null) {
  const body = { status }
  if (errorMessage) body.error_message = errorMessage
  if (evidence) body.evidence = evidence

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await fetch(`${KIOSK_API_BASE_URL}/api/kiosk/${KIOSK_ID}/job/${jobId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${KIOSK_API_KEY}`,
        },
        body: JSON.stringify(body),
      })

      if (response.ok) {
        log(`Reported job ${jobId} as ${status}`)
        return true
      }
      const text = await response.text()
      if (response.status === 404 || response.status === 409) {
        // Already final / not ours — nothing more to do
        logError(`Server refused status ${status} for ${jobId}`, text)
        return true
      }
      logError(`Failed to report job status ${status} for ${jobId} (HTTP ${response.status})`, text)
    } catch (err) {
      logError(`Network error reporting job status for ${jobId}:`, err.message)
    }
    await new Promise((r) => setTimeout(r, attempt * 3000))
  }
  return false
}

/** Android USB printers: (firmware) → render → send → wait → evidence. */
async function printWithUsb(job, pdfPath) {
  const zjsPath = path.join(TEMP_DIR, `job_${job.id}.prn`)
  try {
    await printer.ensureFirmware(log)
    const copies = Math.max(1, Number(job.copies) || 1)

    // Don't start a job the printer can't finish right now
    const checkReady = async () => {
      const state = await printer.probe()
      if (!state.present) throw new PrinterError('PRINTER_NOT_FOUND', 'Printer not connected or powered off')
      if (state.paper_empty) throw new PrinterError('PAPER_OUT', 'Printer is out of paper — nothing was printed')
      if (state.error) throw new PrinterError('PRINTER_ERROR', 'Printer reports an error — nothing was printed')
    }

    let pages
    let sent = 0
    let firstCopyDone = false
    if (printer.printStreaming) {
      // Render and print at the same time: the first page starts printing
      // while the rest is still being rendered
      await checkReady()
      journalSet(job.id, 'sending', { bytes_sent: 0 })
      log('Rendering and printing...')
      const r = await printer.printStreaming(pdfPath, job, zjsPath)
      pages = r.pages
      sent = r.sent
      firstCopyDone = true
      log(`Printed copy 1/${copies}: ${pages} page(s), ${r.bytes} bytes.`)
      journalSet(job.id, 'sending', { bytes_sent: sent })
    } else {
      journalSet(job.id, 'rendering')
      log('Rendering document for the printer...')
      const r = await printer.render(pdfPath, job, zjsPath)
      pages = r.pages
      log(`Rendered ${pages} page(s), ${r.bytes} bytes per copy, ${copies} cop${copies === 1 ? 'y' : 'ies'}.`)
      await checkReady()
      journalSet(job.id, 'sending', { bytes_sent: 0 })
    }

    for (let c = firstCopyDone ? 2 : 1; c <= copies; c++) {
      log(`Sending copy ${c}/${copies}...`)
      sent += await printer.sendCopy(zjsPath, sent)
      journalSet(job.id, 'sending', { bytes_sent: sent })
    }
    journalSet(job.id, 'sent', { bytes_sent: sent })

    const wait = await printer.waitForPrint(pages * copies, log, job)
    return {
      confirmation: 'inferred', // no readable page counter — see printers/*.js
      backend: PRINT_BACKEND,
      pages,
      copies,
      sheets: pages * copies,
      bytes_sent: sent,
      firmware: wait.final_status.firmware,
      model: wait.final_status.model,
      waited_ms: wait.waited_ms,
      final_status: wait.final_status,
    }
  } finally {
    fs.rmSync(zjsPath, { force: true })
  }
}

async function processJob(job) {
  const tempFilePath = path.join(TEMP_DIR, `job_${job.id}_${crypto.randomBytes(4).toString('hex')}.pdf`)
  journalSet(job.id, 'claimed')

  try {
    log(`Downloading PDF...`)
    await downloadPdf(job.file_url, tempFilePath)
    log(`Download complete.`)

    let evidence
    if (USB_BACKENDS.includes(PRINT_BACKEND)) {
      evidence = await printWithUsb(job, tempFilePath)
    } else if (PRINT_BACKEND === 'sumatra') {
      if (!PRINTER_NAME) throw new Error('PRINTER_NAME is not set in .env')
      const cmd = buildSumatraCommand(tempFilePath, job)
      log(`Executing print: ${cmd}`)
      journalSet(job.id, 'sending')
      await executePrint(cmd)
      // Windows only tells us the job was spooled, not that paper came out
      evidence = { confirmation: 'spooled', backend: 'sumatra', printer: PRINTER_NAME }
    } else {
      log(`[FAKE BACKEND] Not printing anything — development only.`)
      await new Promise((r) => setTimeout(r, 3000))
      evidence = { confirmation: 'none', backend: 'fake' }
    }

    log(`Print finished (${evidence.confirmation}).`)
    if (await reportJobStatus(job.id, 'completed', null, evidence)) journalDelete(job.id)
  } catch (jobErr) {
    const mayHavePrinted = jobErr instanceof PrinterError ? jobErr.mayHavePrinted : false
    const message = mayHavePrinted ? `${jobErr.message} — some pages may have printed` : jobErr.message
    logError(`Job execution failed:`, message)
    const evidence = {
      code: jobErr.code || 'ERROR',
      may_have_printed: mayHavePrinted,
      ...(printer && printer.lastStatus ? { printer_status: printer.lastStatus } : {}),
    }
    if (await reportJobStatus(job.id, 'failed', message, evidence)) journalDelete(job.id)
  } finally {
    // Cleanup temp file
    fs.rmSync(tempFilePath, { force: true })
  }
}

async function pollQueue() {
  // isPolling also covers the HTTP request itself, so a slow poll can never
  // overlap the next interval tick and start a second job on the printer.
  if (isProcessingJob || isPolling) return
  isPolling = true

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
    await processJob(job)
    log(`---`)
  } catch (err) {
    logError('Poll network error:', err.message)
  } finally {
    isProcessingJob = false
    isPolling = false
  }
}

// ─── KIOSK SCREEN LOCK (Android) ────────────────────────────────────────────

let isCheckingLock = false

/** Re-pin the kiosk screen if it was unpinned. Quiet unless it re-locked. */
function ensureKioskLock() {
  if (isCheckingLock) return
  isCheckingLock = true
  const script = path.join(__dirname, 'android', 'kiosk.sh')
  execFile('/system/bin/su', ['-c', `sh ${script} ensure`], { timeout: 30000 }, (err, stdout) => {
    isCheckingLock = false
    const out = (stdout || '').trim()
    if (out) log(`Kiosk lock: ${out}`)
    if (err && !out) logError('Kiosk lock check failed:', err.message)
  })
}

// ─── STAFF UNLOCK (Android) ─────────────────────────────────────────────────
// Kiosk mode hides the navigation bar, so staff exit from the screen itself:
// the kiosk page (hold the logo 5 s) posts the staff PIN here. Listens on
// 127.0.0.1 only, accepts only the kiosk site's origin, compares a SHA-256
// hash of the PIN, and locks out after 5 wrong PINs in 10 minutes.

let staffFailures = []

function startStaffServer() {
  const allowedOrigin = new URL(KIOSK_API_BASE_URL).origin
  const headers = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
    'Content-Type': 'application/json',
  }

  const server = http.createServer((req, res) => {
    const send = (code, body) => { res.writeHead(code, headers); res.end(JSON.stringify(body)) }
    if (req.method === 'OPTIONS') { res.writeHead(204, headers); return res.end() }
    if (req.method !== 'POST' || req.url !== '/kiosk/unlock') return send(404, { error: 'Not found' })
    if (req.headers.origin && req.headers.origin !== allowedOrigin) return send(403, { error: 'Forbidden' })

    const now = Date.now()
    staffFailures = staffFailures.filter((t) => now - t < 10 * 60 * 1000)
    if (staffFailures.length >= 5) return send(429, { error: 'Too many wrong PINs - wait 10 minutes' })

    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 1024) req.destroy()
    })
    req.on('end', () => {
      let pin = ''
      try { pin = String(JSON.parse(raw).pin || '') } catch { /* invalid body = wrong PIN */ }
      const hash = crypto.createHash('sha256').update(pin).digest('hex')
      const ok = hash.length === STAFF_PIN_SHA256.length &&
        crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(STAFF_PIN_SHA256))
      if (!ok) {
        staffFailures.push(now)
        log('Staff unlock: wrong PIN')
        return send(401, { error: 'Wrong PIN' })
      }

      log('Staff unlock: PIN accepted - kiosk unlocked for maintenance (auto re-lock in 30 min)')
      send(200, { ok: true })
      // Let the response reach the page before Chrome is restarted unlocked
      setTimeout(() => {
        const script = path.join(__dirname, 'android', 'kiosk.sh')
        execFile('/system/bin/su', ['-c', `sh ${script} unlock`], { timeout: 30000 }, (err, stdout) => {
          if (err) logError('Staff unlock failed:', err.message)
          else log(`Kiosk lock: ${(stdout || '').trim()}`)
        })
      }, 1500)
    })
  })

  server.on('error', (err) => logError('Staff unlock server error:', err.message))
  server.listen(STAFF_PORT, '127.0.0.1', () => log(`Staff unlock listening on 127.0.0.1:${STAFF_PORT}`))
}

// ─── CRASH RECOVERY ─────────────────────────────────────────────────────────

/**
 * Jobs left in the journal were interrupted (crash, power cut, restart).
 * Report each one as failed with what we know — never reprint automatically.
 */
async function recoverJournal() {
  const journal = readJournal()
  const ids = Object.keys(journal)
  if (ids.length === 0) return

  log(`Found ${ids.length} interrupted job(s) in the local journal.`)
  for (const id of ids) {
    const entry = journal[id]
    const reached = ['sending', 'sent'].includes(entry.stage)
    const message = reached
      ? `Interrupted while printing (agent restart) — ${entry.bytes_sent || 0} bytes had reached the printer; some pages may have printed`
      : 'Interrupted before printing (agent restart) — nothing was sent to the printer'
    const done = await reportJobStatus(id, 'failed', message, {
      code: 'INTERRUPTED', stage: entry.stage, may_have_printed: reached, bytes_sent: entry.bytes_sent || 0,
    })
    if (done) journalDelete(id)
  }
}

/**
 * On startup, any job stuck in 'printing' for >10 minutes means the agent
 * crashed mid-print. The server marks them failed for review (never requeued).
 */
async function recoverStaleJobs() {
  log('Checking for stale jobs stuck in \'printing\'...')

  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()

  try {
    // We call the kiosk API rather than hitting Supabase directly,
    // so no Supabase keys are needed in the agent.
    const res = await fetch(
      `${KIOSK_API_BASE_URL}/api/kiosk/${KIOSK_ID}/stale-jobs`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${KIOSK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ stale_before: tenMinutesAgo }),
      }
    )

    if (!res.ok) {
      logError(`Stale job recovery failed (HTTP ${res.status})`, await res.text())
      return
    }

    const data = await res.json()
    if (data.interrupted && data.interrupted > 0) {
      log(`⚠ ${data.interrupted} stale job(s) marked failed for review (not reprinted).`)
    } else {
      log('✓ No stale jobs found.')
    }
  } catch (err) {
    logError('Stale job recovery network error (non-fatal):', err.message)
  }
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('')
  console.log('╔═══════════════════════════════════════════════════════════╗')
  console.log('║              VaultPrint Print Agent v1.1                  ║')
  console.log('╚═══════════════════════════════════════════════════════════╝')
  console.log('')
  log(`Platform:    ${PLATFORM} (${os.type()} ${os.release()})`)
  log(`Kiosk ID:    ${KIOSK_ID}`)
  log(`API Base:    ${KIOSK_API_BASE_URL}`)
  log(`Printer:     ${PRINTER_NAME || '(not configured)'}`)
  log(`Backend:     ${PRINT_BACKEND}`)
  log(`Hostname:    ${os.hostname()}`)
  console.log('')

  if (printer) {
    try {
      printer.selfCheck()
    } catch (err) {
      fatal(err.message)
    }
    const state = await printer.probe()
    log(`Printer:     present=${state.present} ${state.model ? 'model=' + state.model : 'firmware=' + (state.firmware || 'not loaded')} ready=${state.ready}`)
    if (state.present && !state.firmware_loaded) {
      try {
        await printer.ensureFirmware(log)
      } catch (err) {
        logError('Firmware upload at startup failed (will retry per job):', err.message)
      }
    }
  }

  // Send initial heartbeat immediately
  log('Sending initial heartbeat...')
  const firstHeartbeat = await sendHeartbeat()

  if (firstHeartbeat) {
    log('✓ Agent connected successfully. Kiosk is now online.')
  } else {
    log('⚠ Initial heartbeat failed. Will retry in 30s. Check your API key and network.')
  }

  // Report jobs this agent was in the middle of before it stopped
  await recoverJournal()
  // Jobs stuck in 'printing' on the server for >10 minutes
  await recoverStaleJobs()

  // Start heartbeat loop
  log(`Starting heartbeat loop (every ${HEARTBEAT_INTERVAL_MS / 1000}s)...`)
  setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS)

  // Start queue polling loop
  log(`Starting queue polling (every ${POLL_INTERVAL_MS / 1000}s)...`)
  setInterval(pollQueue, POLL_INTERVAL_MS)

  if (PLATFORM === 'android' && process.env.KIOSK_LOCK !== 'off') {
    log(`Starting kiosk screen lock watchdog (every ${KIOSK_LOCK_INTERVAL_MS / 1000}s)...`)
    ensureKioskLock()
    setInterval(ensureKioskLock, KIOSK_LOCK_INTERVAL_MS)
    if (/^[0-9a-f]{64}$/.test(STAFF_PIN_SHA256)) startStaffServer()
    else log('⚠ STAFF_PIN_SHA256 not set - on-screen staff unlock disabled')
  }

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
