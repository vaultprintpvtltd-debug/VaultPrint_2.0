// ---------------------------------------------------------------------------
// VaultPrint Mode 2 File Receiver (PRD C2.9)
//
// Token-gated Express server on the Android kiosk (Termux + pm2), separate
// process from agent.js. Accepts the iPad's PDF over the local hotspot and
// forwards it to the Kiosk App's mode2/session API (which holds the
// authoritative token check).
//
// Hardening:
//   - GET /upload and POST /upload refuse to work without a ?t= token
//     (friendly early error; the AUTHORITATIVE check is server-side)
//   - Temp dir: $HOME/vaultprint-incoming (Termux has no /tmp)
//   - Server-controlled random filenames — client name is display-only
//   - 50 MB multer cap, PDF-only filter
//   - Sweeper: every 10 minutes, purges temp files older than 15 minutes
//   - Temp file cleaned up on every error path
// ---------------------------------------------------------------------------

require('dotenv').config()
const express = require('express')
const multer = require('multer')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

// ─── ENV VALIDATION ─────────────────────────────────────────────────────────

const KIOSK_ID = process.env.KIOSK_ID
const KIOSK_API_KEY = process.env.KIOSK_API_KEY
const KIOSK_API_BASE_URL = process.env.KIOSK_API_BASE_URL
const RECEIVER_PORT = parseInt(process.env.RECEIVER_PORT || '4000', 10)

function fatal(message) {
  console.error(`[VaultPrint FileReceiver] FATAL: ${message}`)
  process.exit(1)
}

if (!KIOSK_ID) fatal('KIOSK_ID is not set in .env')
if (!KIOSK_API_KEY) fatal('KIOSK_API_KEY is not set in .env')
if (!KIOSK_API_BASE_URL) fatal('KIOSK_API_BASE_URL is not set in .env')

const isLocalDev = KIOSK_API_BASE_URL.includes('localhost') || KIOSK_API_BASE_URL.includes('127.0.0.1')
if (!isLocalDev && !KIOSK_API_BASE_URL.includes('kiosk.')) {
  fatal(`KIOSK_API_BASE_URL must contain "kiosk." — got: ${KIOSK_API_BASE_URL}`)
}

// ─── TEMP DIR ($HOME/vaultprint-incoming — NOT /tmp, Termux) ────────────────

const INCOMING_DIR = path.join(os.homedir(), 'vaultprint-incoming')
if (!fs.existsSync(INCOMING_DIR)) {
  fs.mkdirSync(INCOMING_DIR, { recursive: true })
}

// ─── LOGGING ────────────────────────────────────────────────────────────────

function log(message) {
  console.log(`[${new Date().toISOString()}] [VaultPrint FileReceiver] ${message}`)
}
function logError(message, err) {
  console.error(`[${new Date().toISOString()}] [VaultPrint FileReceiver] ERROR: ${message}`, err || '')
}

// ─── MULTER — server-controlled random filenames, 50MB, PDF-only ────────────

const MAX_FILE_BYTES = 50 * 1024 * 1024

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, INCOMING_DIR),
  filename: (req, file, cb) =>
    // NEVER trust the client filename for the on-disk name
    cb(null, `upload_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.pdf`),
})

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    // Advisory only — the authoritative check is the server-side pdf-lib parse
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are accepted'))
    }
    cb(null, true)
  },
})

function cleanupTempFile(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath)
    } catch (e) {
      logError(`Failed to delete temp file ${filePath}`, e.message)
    }
  }
}

// ─── SWEEPER — every 10 min, purge temp files older than 15 min ─────────────
// Closes the privacy/disk leak from crashed or abandoned sessions.

const SWEEP_INTERVAL_MS = 10 * 60 * 1000
const MAX_FILE_AGE_MS = 15 * 60 * 1000

function sweep() {
  try {
    const now = Date.now()
    for (const name of fs.readdirSync(INCOMING_DIR)) {
      const filePath = path.join(INCOMING_DIR, name)
      try {
        const stat = fs.statSync(filePath)
        if (stat.isFile() && now - stat.mtimeMs > MAX_FILE_AGE_MS) {
          fs.unlinkSync(filePath)
          log(`Sweeper purged stale temp file: ${name}`)
        }
      } catch {
        /* file vanished mid-sweep — fine */
      }
    }
  } catch (e) {
    logError('Sweeper failed:', e.message)
  }
}

// ─── HTML helpers (minimal, no external assets — iPad has no internet) ──────

function page(title, bodyHtml) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;background:#09090b;color:#f4f4f5;
       display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}
  .card{background:#18181b;border:1px solid #27272a;border-radius:20px;padding:32px;max-width:440px;width:100%;text-align:center}
  h1{font-size:22px;margin:0 0 8px}
  p{color:#a1a1aa;font-size:15px;line-height:1.5}
  input[type=file]{margin:20px 0;width:100%;color:#a1a1aa}
  button{background:#14b8a6;color:#042f2e;border:none;border-radius:12px;padding:14px 28px;
         font-size:17px;font-weight:700;width:100%;cursor:pointer}
  button:disabled{opacity:.5}
  .err{color:#f87171}
  .ok{color:#2dd4bf}
</style></head><body><div class="card">${bodyHtml}</div></body></html>`
}

// ─── EXPRESS APP ────────────────────────────────────────────────────────────

const app = express()
app.disable('x-powered-by')

// GET /upload — the Safari file picker. Refuses to render without ?t=
app.get('/upload', (req, res) => {
  const token = req.query.t
  if (!token || typeof token !== 'string') {
    return res
      .status(403)
      .send(page('VaultPrint', `<h1 class="err">Session required</h1>
        <p>Please scan the QR code shown on the kiosk screen to start an upload.</p>`))
  }

  res.send(page('VaultPrint — Upload', `
    <h1>Upload your PDF</h1>
    <p>Choose the document you want to print. PDF only, up to 50&nbsp;MB.</p>
    <form method="POST" action="/upload?t=${encodeURIComponent(token)}" enctype="multipart/form-data"
          onsubmit="document.getElementById('go').disabled=true;document.getElementById('go').textContent='Uploading…'">
      <input type="file" name="file" accept="application/pdf" required>
      <button id="go" type="submit">Upload</button>
    </form>`))
})

// POST /upload — receive the PDF, forward to the kiosk API, clean up.
app.post('/upload', (req, res) => {
  const token = req.query.t
  if (!token || typeof token !== 'string') {
    return res
      .status(403)
      .send(page('VaultPrint', `<h1 class="err">Session required</h1>
        <p>Please scan the QR code on the kiosk screen and try again.</p>`))
  }

  upload.single('file')(req, res, async (multerErr) => {
    const tempPath = req.file ? req.file.path : null

    if (multerErr) {
      cleanupTempFile(tempPath)
      const msg =
        multerErr.code === 'LIMIT_FILE_SIZE'
          ? 'That file is larger than 50 MB.'
          : multerErr.message || 'Upload failed.'
      return res
        .status(400)
        .send(page('VaultPrint', `<h1 class="err">Upload failed</h1><p>${msg}</p>
          <p><a style="color:#2dd4bf" href="/upload?t=${encodeURIComponent(token)}">Try again</a></p>`))
    }

    if (!req.file) {
      return res
        .status(400)
        .send(page('VaultPrint', `<h1 class="err">No file received</h1>
          <p>Please choose a PDF and try again.</p>`))
    }

    log(`Received file (${req.file.size} bytes) → ${req.file.filename}`)

    try {
      // Forward to the kiosk API — the authoritative validation chain
      const buffer = fs.readFileSync(tempPath)
      const form = new FormData()
      form.append('token', token)
      form.append('local_path', tempPath)
      form.append('file_name', req.file.originalname || 'document.pdf')
      form.append('file', new Blob([buffer], { type: 'application/pdf' }), 'upload.pdf')

      const response = await fetch(
        `${KIOSK_API_BASE_URL}/api/kiosk/${KIOSK_ID}/mode2/session`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${KIOSK_API_KEY}` },
          body: form,
        }
      )

      const data = await response.json().catch(() => ({}))

      // Success or failure, the temp copy is no longer needed
      cleanupTempFile(tempPath)

      if (!response.ok) {
        logError(`mode2/session rejected upload (HTTP ${response.status})`, JSON.stringify(data))
        return res
          .status(response.status)
          .send(page('VaultPrint', `<h1 class="err">Upload rejected</h1>
            <p>${data.error || 'The kiosk could not accept this file.'}</p>
            <p>Please return to the kiosk screen and start again.</p>`))
      }

      log(`Upload accepted — job ${data.job_id}`)
      return res.send(page('VaultPrint', `<h1 class="ok">Upload complete ✓</h1>
        <p>Your document (${data.total_pages} page${data.total_pages === 1 ? '' : 's'}) has been
        sent to the kiosk.</p><p><strong>Continue on the kiosk screen.</strong></p>`))
    } catch (err) {
      cleanupTempFile(tempPath)
      logError('Failed to forward upload to kiosk API:', err.message)
      return res
        .status(502)
        .send(page('VaultPrint', `<h1 class="err">Kiosk unreachable</h1>
          <p>The kiosk could not process your upload. Please tell the staff or try again.</p>`))
    }
  })
})

// Everything else → friendly redirect hint
app.use((req, res) => {
  res
    .status(404)
    .send(page('VaultPrint', `<h1>VaultPrint</h1>
      <p>Please scan the QR code on the kiosk screen to upload a document.</p>`))
})

// ─── MAIN ───────────────────────────────────────────────────────────────────

app.listen(RECEIVER_PORT, () => {
  console.log('')
  console.log('╔═══════════════════════════════════════════════════════════╗')
  console.log('║          VaultPrint Mode 2 File Receiver v1.0             ║')
  console.log('╚═══════════════════════════════════════════════════════════╝')
  log(`Listening on port ${RECEIVER_PORT}`)
  log(`Incoming dir: ${INCOMING_DIR}`)
  log(`Kiosk ID:     ${KIOSK_ID}`)
  sweep() // clear anything left over from before a crash/reboot
  setInterval(sweep, SWEEP_INTERVAL_MS)
})

process.on('uncaughtException', (err) => {
  logError('Uncaught exception:', err)
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  logError('Unhandled rejection:', reason)
  process.exit(1)
})
