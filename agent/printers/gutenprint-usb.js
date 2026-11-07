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
// After the last byte is accepted the printer still finishes what it holds
// in its buffer (an inkjet takes data only as fast as it prints)
const TAIL_SECONDS = 15
const TAIL_SECONDS_PER_SHEET = 2 // buffered pages, counted up to 5

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

  gsArgs(pdfPath, job) {
    const colour = job.color_mode === 'colour'
    const args = [
      '-q', '-dBATCH', '-dSAFER', '-dNOPAUSE', '-dQUIET',
      '-sstdout=%stderr', // keep PostScript chatter out of the raster stream
      `-sDEVICE=${colour ? 'ppmraw' : 'pgmraw'}`, `-r${RES}`, `-g${DIM}`,
      '-sPAPERSIZE=a4', '-dFIXEDMEDIA', '-dPDFFitPage',
      '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4',
    ]
    if (job.pages_to_print && job.pages_to_print !== 'all') {
      if (!/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(job.pages_to_print)) {
        throw new PrinterError('INVALID_PAGE_RANGE', `Invalid page range "${job.pages_to_print}"`)
      }
      args.push(`-sPageList=${job.pages_to_print}`)
    }
    args.push('-sOutputFile=-', '--', pdfPath)
    return args
  }

  /**
   * Ghostscript → vp-gutenprint, written to outPath and — when `toPrinter` —
   * streamed to the printer at the same time, so printing starts with the
   * first page instead of after the whole document is rendered. Both
   * destinations take the data at the pace of the slower one (the printer).
   * Resolves { pages, bytes, sent }.
   */
  pipeline(pdfPath, job, outPath, toPrinter) {
    return new Promise((resolve, reject) => {
      let gsArgs
      try { gsArgs = this.gsArgs(pdfPath, job) } catch (err) { return reject(err) }
      const gpArgs = ['-d', this.driver, '-m', job.color_mode === 'colour' ? 'Color' : 'BW', '-s', 'A4', '-t', 'Plain']

      const gs = spawn(this.gs, gsArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
      const gp = spawn(path.join(this.binDir, 'vp-gutenprint'), gpArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
      const out = fs.createWriteStream(outPath)
      const usb = toPrinter
        ? spawn(this.su, ['-c', `${path.join(this.binDir, 'vp-usbprint')} -d ${this.device} -t 120000 send`], { stdio: ['pipe', 'ignore', 'pipe'] })
        : null

      const err = { gs: '', gp: '', usb: '' }
      const code = { gs: null, gp: null, usb: toPrinter ? null : 0 }
      let outDone = false
      let settled = false

      gs.stdout.pipe(gp.stdin)
      gs.stderr.on('data', (d) => { err.gs += d })
      gp.stderr.on('data', (d) => { err.gp += d })
      gp.stdin.on('error', () => {}) // reported via exit codes
      gp.stdout.pipe(out)
      if (usb) {
        gp.stdout.pipe(usb.stdin)
        usb.stdin.on('error', () => {}) // printer gone mid-send → exit code says so
        usb.stderr.on('data', (d) => { err.usb += d })
      }

      const sentBytes = () => {
        const m = /sent (\d+) bytes/.exec(err.usb)
        return m ? Number(m[1]) : 0
      }
      const fail = (e) => {
        if (settled) return
        settled = true
        for (const p of [gs, gp, usb]) if (p) p.kill()
        reject(e)
      }
      const finish = () => {
        if (settled || code.gs === null || code.gp === null || code.usb === null || !outDone) return
        settled = true
        const sent = sentBytes()
        if (code.usb !== 0) {
          const any = sent > 0
          if (code.usb === 2) return reject(new PrinterError('PRINTER_NOT_FOUND', 'Printer disconnected during printing', any))
          if (code.usb === 3) return reject(new PrinterError('PRINTER_STALLED', 'Printer stopped accepting data (out of paper, paper jam, ink problem or power loss)', any))
          return reject(new PrinterError('USB_ERROR', `USB error: ${err.usb.trim().slice(0, 200)}`, any))
        }
        if (code.gs !== 0) {
          return reject(new PrinterError('RENDER_FAILED', `Could not render document (Ghostscript ${code.gs}): ${err.gs.trim().slice(0, 300)}`, sent > 0))
        }
        if (code.gp !== 0) {
          return reject(new PrinterError('ENCODE_FAILED', `Printer encoding failed (vp-gutenprint ${code.gp}): ${err.gp.trim().slice(0, 300)}`, sent > 0))
        }
        const m = /pages (\d+)/.exec(err.gp)
        const pages = m ? Number(m[1]) : 0
        if (pages < 1) return reject(new PrinterError('RENDER_FAILED', 'Document rendered to zero pages'))
        resolve({ pages, bytes: fs.statSync(outPath).size, sent })
      }
      // A process killed by a signal closes with code null: count it as a
      // failure (-1), or finish() would wait for it forever
      gs.on('close', (c) => { code.gs = c ?? -1; finish() })
      gp.on('close', (c) => { code.gp = c ?? -1; finish() })
      out.on('close', () => { outDone = true; finish() })
      if (usb) {
        usb.on('close', (c) => {
          code.usb = c ?? -1
          // Printer gone: stop rendering, report it
          if (c !== 0) { gs.kill(); gp.kill() }
          finish()
        })
        usb.on('error', (e) => fail(new PrinterError('USB_ERROR', `Could not start the USB sender: ${e.message}`)))
      }
      gs.on('error', (e) => fail(new PrinterError('RENDER_FAILED', `Ghostscript not available: ${e.message}`)))
      gp.on('error', (e) => fail(new PrinterError('ENCODE_FAILED', `vp-gutenprint not available: ${e.message}`)))
    })
  }

  /** Render only (no printing) — the file can then be sent with sendCopy. */
  render(pdfPath, job, outPath) {
    return this.pipeline(pdfPath, job, outPath, false)
  }

  /** Render and print copy 1 at the same time; outPath keeps it for more copies. */
  printStreaming(pdfPath, job, outPath) {
    return this.pipeline(pdfPath, job, outPath, true)
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
  async waitForPrint(sheets, log) {
    // Called once every byte has been accepted — only the buffered tail is left
    const expectedMs = (TAIL_SECONDS + TAIL_SECONDS_PER_SHEET * Math.min(sheets, 5)) * 1000
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
