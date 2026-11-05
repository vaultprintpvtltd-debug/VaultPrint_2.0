// ---------------------------------------------------------------------------
// Gutenprint-over-USB printer backend — Canon PIXMA G2010 on Android
//
// The G2010 is a USB-only inkjet that speaks Canon's BJRaster3 inside an
// IVEC job wrapper (IEEE-1284 "CMD:BJRaster3,IVEC"). Gutenprint's "Canon
// G2000 series" driver produces exactly that and is verified on this printer.
// The TX3 box has no USB printer driver, so data goes over raw usbfs.
//
//   PDF ─ Ghostscript (pgmraw / ppmraw, A4, 300 dpi) ─▶ vp-gutenprint ─▶ vp-usbprint ─▶ USB
//
// vp-gutenprint is a static armhf build of Gutenprint 5.3.4 (see
// android/build-gutenprint.sh). Only vp-usbprint runs as root (via su).
//
// Unlike the HP 1020 there is no firmware to load. Completion is INFERRED,
// not confirmed: the printer accepted every byte and reported no error after
// the expected print time. The G2010 has no page counter readable over USB.
// ---------------------------------------------------------------------------

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const { PrinterError } = require('./zjs-usb')

// Rendering resolution: Gutenprint resamples to the printer's own resolution;
// 300 dpi input keeps text sharp at a quarter of 600 dpi's work on the box.
const RES = 300
const DIM = '2480x3508' // A4 at 300 dpi
// G2010 ISO speed: ~8.8 ipm black, ~5 ipm colour, plus first-page warm-up
const SECONDS_PER_PAGE = { bw: 8, colour: 14 }
const WARMUP_SECONDS = 25

/** Run a command; resolve { code, stdout, stderr }. Never rejects on exit code. */
function run(cmd, args, { input, timeoutMs = 60000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(err) }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
    // The child can exit before taking all its input (printer unplugged
    // mid-send): that is EPIPE here, and its exit code says what happened
    child.stdin.on('error', () => {})
    if (input) {
      const src = fs.createReadStream(input)
      src.on('error', (err) => { stderr += String(err); child.kill('SIGKILL') })
      src.pipe(child.stdin)
    } else child.stdin.end()
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class GutenprintUsbPrinter {
  constructor({ binDir, gs = 'gs', su = '/system/bin/su', device = '04a9:183a', driver = 'bjc-G2000-series' }) {
    this.binDir = binDir
    this.gs = gs
    this.su = su
    this.device = device
    this.driver = driver
    this.lastStatus = null
  }

  /** vp-usbprint runs as root; the command string contains no job input. */
  usb(args, opts) {
    const cmd = `${path.join(this.binDir, 'vp-usbprint')} -d ${this.device} ${args}`
    return run(this.su, ['-c', cmd], opts)
  }

  /** Checks the binaries exist — called once at agent start. */
  selfCheck() {
    const missing = ['vp-usbprint', 'vp-gutenprint']
      .map((f) => path.join(this.binDir, f))
      .filter((f) => !fs.existsSync(f))
    if (missing.length) throw new Error(`Gutenprint backend missing: ${missing.join(', ')}`)
  }

  /** Current printer state. Never throws. */
  async probe() {
    const id = await this.usb('id', { timeoutMs: 15000 })
    if (id.code === 2) return (this.lastStatus = { present: false, firmware_loaded: false, ready: false })
    if (id.code !== 0) return (this.lastStatus = { present: true, firmware_loaded: false, ready: false, error: true, detail: id.stderr.trim() })

    const model = /MDL:([^;]+)/.exec(id.stdout)
    const sta = /STA:([^;]+)/.exec(id.stdout)
    // No firmware on an inkjet: "loaded" means it answered its device ID
    const state = { present: true, firmware_loaded: true, model: model ? model[1] : null, device_status: sta ? sta[1] : null }
    const st = await this.usb('status', { timeoutMs: 15000 })
    const m = /paper_empty=(\d) selected=(\d) error=(\d)/.exec(st.stdout)
    if (m) {
      state.paper_empty = m[1] === '1'
      state.selected = m[2] === '1'
      state.error = m[3] === '1'
    }
    state.ready = !!(m && !state.paper_empty && state.selected && !state.error)
    return (this.lastStatus = state)
  }

  /** Nothing to upload — just confirm the printer is there. */
  async ensureFirmware() {
    const state = await this.probe()
    if (!state.present) throw new PrinterError('PRINTER_NOT_FOUND', 'Printer not connected or powered off')
    return state
  }

  /**
   * Render a PDF to a printer job file. Streams Ghostscript's pages straight
   * into vp-gutenprint (constant memory); vp-gutenprint reports the page count.
   */
  render(pdfPath, job, outPath) {
    return new Promise((resolve, reject) => {
      const colour = job.color_mode === 'colour'
      const gsArgs = [
        '-q', '-dBATCH', '-dSAFER', '-dNOPAUSE', '-dQUIET',
        '-sstdout=%stderr', // keep PostScript chatter out of the raster stream
        `-sDEVICE=${colour ? 'ppmraw' : 'pgmraw'}`, `-r${RES}`, `-g${DIM}`,
        '-sPAPERSIZE=a4', '-dFIXEDMEDIA', '-dPDFFitPage',
        '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4',
      ]
      if (job.pages_to_print && job.pages_to_print !== 'all') {
        if (!/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(job.pages_to_print)) {
          return reject(new PrinterError('INVALID_PAGE_RANGE', `Invalid page range "${job.pages_to_print}"`))
        }
        gsArgs.push(`-sPageList=${job.pages_to_print}`)
      }
      gsArgs.push('-sOutputFile=-', '--', pdfPath)

      const gpArgs = ['-d', this.driver, '-m', colour ? 'Color' : 'BW', '-s', 'A4', '-t', 'Plain']

      const gs = spawn(this.gs, gsArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
      const gp = spawn(path.join(this.binDir, 'vp-gutenprint'), gpArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
      const out = fs.createWriteStream(outPath)

      let gsErr = ''
      let gpErr = ''
      let gsCode = null
      let gpCode = null
      let outDone = false
      let settled = false

      gs.stdout.pipe(gp.stdin)
      gs.stderr.on('data', (d) => { gsErr += d })
      gp.stderr.on('data', (d) => { gpErr += d })
      gp.stdout.pipe(out)
      gp.stdin.on('error', () => {}) // reported via exit codes below

      // Settle only once Ghostscript, vp-gutenprint AND the output file are done
      const finish = () => {
        if (settled || gsCode === null || gpCode === null || !outDone) return
        settled = true
        if (gsCode !== 0) {
          return reject(new PrinterError('RENDER_FAILED', `Could not render document (Ghostscript ${gsCode}): ${gsErr.trim().slice(0, 300)}`))
        }
        if (gpCode !== 0) {
          return reject(new PrinterError('ENCODE_FAILED', `Printer encoding failed (vp-gutenprint ${gpCode}): ${gpErr.trim().slice(0, 300)}`))
        }
        const m = /pages (\d+)/.exec(gpErr)
        const pages = m ? Number(m[1]) : 0
        if (pages < 1) return reject(new PrinterError('RENDER_FAILED', 'Document rendered to zero pages'))
        resolve({ pages, bytes: fs.statSync(outPath).size })
      }
      gs.on('close', (code) => { gsCode = code; finish() })
      gp.on('close', (code) => { gpCode = code; finish() })
      out.on('close', () => { outDone = true; finish() })
      const fail = (err) => { if (!settled) { settled = true; gs.kill(); gp.kill(); reject(err) } }
      gs.on('error', (e) => fail(new PrinterError('RENDER_FAILED', `Ghostscript not available: ${e.message}`)))
      gp.on('error', (e) => fail(new PrinterError('ENCODE_FAILED', `vp-gutenprint not available: ${e.message}`)))
    })
  }

  /** Send one rendered copy. `sentBefore` = bytes of earlier copies. */
  async sendCopy(jobPath, sentBefore) {
    // An inkjet takes data only as fast as it prints: allow a long stall
    const res = await this.usb('-t 120000 send', { input: jobPath, timeoutMs: 20 * 60 * 1000 })
    const m = /sent (\d+) bytes/.exec(res.stderr)
    const sent = m ? Number(m[1]) : 0
    if (res.code === 0) return sent

    const anySent = sentBefore + sent > 0
    if (res.code === 2) throw new PrinterError('PRINTER_NOT_FOUND', 'Printer disconnected during printing', anySent)
    if (res.code === 3) {
      throw new PrinterError('PRINTER_STALLED', 'Printer stopped accepting data (paper jam, out of paper, ink problem or power loss)', anySent)
    }
    throw new PrinterError('USB_ERROR', `USB error: ${res.stderr.trim().slice(0, 200)}`, anySent)
  }

  /**
   * Wait out the physical print and check the printer is healthy afterwards.
   * Returns evidence; throws if the printer reports paper-out/error.
   */
  async waitForPrint(sheets, log, job = {}) {
    const perPage = SECONDS_PER_PAGE[job.color_mode === 'colour' ? 'colour' : 'bw']
    const expectedMs = (WARMUP_SECONDS + sheets * perPage) * 1000
    const started = Date.now()
    log(`Waiting ~${Math.round(expectedMs / 1000)}s for ${sheets} sheet(s) to print...`)

    let state = null
    while (Date.now() - started < expectedMs) {
      await sleep(3000)
      state = await this.probe()
      if (!state.present) throw new PrinterError('PRINTER_NOT_FOUND', 'Printer disconnected during printing', true)
      if (state.paper_empty) throw new PrinterError('PAPER_OUT', 'Printer ran out of paper during printing', true)
      if (state.error) throw new PrinterError('PRINTER_ERROR', 'Printer reported an error during printing (possible jam)', true)
    }

    // Final health check, allowing the last page a little longer
    for (let i = 0; i < 5 && !(state && state.ready); i++) {
      await sleep(2000)
      state = await this.probe()
    }
    if (!state || !state.ready) {
      throw new PrinterError('PRINTER_ERROR', 'Printer not ready after printing (check for a jam)', true)
    }
    return { waited_ms: Date.now() - started, final_status: state }
  }
}

module.exports = { GutenprintUsbPrinter }
