// ---------------------------------------------------------------------------
// ZjStream-over-USB printer backend — HP LaserJet 1018/1020/1022 on Android
//
// The LaserJet 1020 is a host-based printer: it only understands ZjStream
// raster data, and it loads its firmware into RAM, so the firmware must be
// sent after every power-on. The TX3 box's kernel has no USB printer driver
// (no /dev/usb/lp0), so data goes over raw usbfs via vp-usbprint.
//
//   PDF ─ Ghostscript (pbmraw, A4, 600x600) ─▶ foo2zjs -z1 ─▶ vp-usbprint ─▶ USB
//
// Only vp-usbprint runs as root (via su) — Ghostscript and foo2zjs run as the
// unprivileged Termux user. Settings mirror foo2zjs-wrapper for the 1020 on A4.
//
// Completion is INFERRED, not confirmed: the printer accepted every byte and
// reported ready/no-error/paper-present after the expected print time. The
// 1020 has no page counter readable over USB.
// ---------------------------------------------------------------------------

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

// A4 at 600x600 dpi, as foo2zjs-wrapper computes it (XDIM 9920/2 x YDIM 7016)
const DIM = '4960x7016'
const RES = '600x600'
const PBM_PAGE_BYTES = Math.ceil(4960 / 8) * 7016
// LaserJet 1020: ~14 ppm on A4 plus warm-up from idle
const SECONDS_PER_PAGE = 4.5
const WARMUP_SECONDS = 10

class PrinterError extends Error {
  /**
   * @param {string} code             machine-readable reason
   * @param {string} message          human-readable, stored on the job
   * @param {boolean} mayHavePrinted  true once any page data reached the printer
   */
  constructor(code, message, mayHavePrinted = false) {
    super(message)
    this.code = code
    this.mayHavePrinted = mayHavePrinted
  }
}

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

class ZjsUsbPrinter {
  constructor({ binDir, firmwarePath, gs = 'gs', su = '/system/bin/su', device = '03f0:2b17' }) {
    this.binDir = binDir
    this.firmwarePath = firmwarePath
    this.gs = gs
    this.su = su
    this.device = device
    this.lastStatus = null
  }

  /** vp-usbprint runs as root; the command string contains no job input. */
  usb(args, opts) {
    const cmd = `${path.join(this.binDir, 'vp-usbprint')} -d ${this.device} ${args}`
    return run(this.su, ['-c', cmd], opts)
  }

  /** Checks the binaries and firmware exist — called once at agent start. */
  selfCheck() {
    const missing = []
    for (const f of [path.join(this.binDir, 'vp-usbprint'), path.join(this.binDir, 'foo2zjs'), this.firmwarePath]) {
      if (!fs.existsSync(f)) missing.push(f)
    }
    if (missing.length) throw new Error(`ZjStream backend missing: ${missing.join(', ')}`)
  }

  /** Current printer state. Never throws. */
  async probe() {
    const id = await this.usb('id', { timeoutMs: 15000 })
    if (id.code === 2) return (this.lastStatus = { present: false, firmware_loaded: false, ready: false })
    if (id.code !== 0) return (this.lastStatus = { present: true, firmware_loaded: false, ready: false, error: id.stderr.trim() })

    const firmware = /FWVER:([^;]+)/.exec(id.stdout)
    const state = { present: true, firmware_loaded: !!firmware, firmware: firmware ? firmware[1] : null }
    const st = await this.usb('status', { timeoutMs: 15000 })
    const m = /paper_empty=(\d) selected=(\d) error=(\d)/.exec(st.stdout)
    if (m) {
      state.paper_empty = m[1] === '1'
      state.selected = m[2] === '1'
      state.error = m[3] === '1'
    }
    state.ready = !!(state.firmware_loaded && m && !state.paper_empty && state.selected && !state.error)
    return (this.lastStatus = state)
  }

  /** Send the firmware if the printer doesn't report it loaded. */
  async ensureFirmware(log) {
    let state = await this.probe()
    if (!state.present) throw new PrinterError('PRINTER_NOT_FOUND', 'Printer not connected or powered off')
    if (state.firmware_loaded) return state

    log('Printer firmware not loaded (printer was power-cycled) — uploading...')
    const res = await this.usb('-t 30000 send', { input: this.firmwarePath, timeoutMs: 60000 })
    if (res.code !== 0) throw new PrinterError('FIRMWARE_FAILED', `Firmware upload failed: ${res.stderr.trim()}`)

    for (let i = 0; i < 10; i++) {
      await sleep(1000)
      state = await this.probe()
      if (state.firmware_loaded) {
        log(`Firmware loaded (FWVER ${state.firmware}).`)
        return state
      }
    }
    throw new PrinterError('FIRMWARE_FAILED', 'Printer did not report firmware after upload')
  }

  /**
   * Render a PDF to a ZjStream file. Streams Ghostscript's raster straight
   * into foo2zjs (no multi-MB-per-page temp files) and counts the pages.
   */
  render(pdfPath, job, zjsPath) {
    return new Promise((resolve, reject) => {
      const gsArgs = [
        '-q', '-dBATCH', '-dSAFER', '-dNOPAUSE', '-dQUIET',
        '-sstdout=%stderr', // keep PostScript chatter out of the raster stream
        '-sDEVICE=pbmraw', `-r${RES}`, `-g${DIM}`,
        '-sPAPERSIZE=a4', '-dFIXEDMEDIA', '-dPDFFitPage',
      ]
      if (job.pages_to_print && job.pages_to_print !== 'all') {
        if (!/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(job.pages_to_print)) {
          return reject(new PrinterError('INVALID_PAGE_RANGE', `Invalid page range "${job.pages_to_print}"`))
        }
        gsArgs.push(`-sPageList=${job.pages_to_print}`)
      }
      gsArgs.push('-sOutputFile=-', '--', pdfPath)

      const fooArgs = [
        `-r${RES}`, `-g${DIM}`, '-p9', '-m1', '-n1', '-d1', '-s7',
        '-z1', '-P', '-L0', '-u96x96', '-l96x96', '-T3',
        '-J', 'VaultPrint', '-U', 'vaultprint',
      ]

      const gs = spawn(this.gs, gsArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
      const foo = spawn(path.join(this.binDir, 'foo2zjs'), fooArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
      const out = fs.createWriteStream(zjsPath)

      let rasterBytes = 0
      let gsErr = ''
      let fooErr = ''
      let gsCode = null
      let fooCode = null
      let outDone = false
      let settled = false

      gs.stdout.on('data', (chunk) => {
        rasterBytes += chunk.length
        if (!foo.stdin.write(chunk)) {
          gs.stdout.pause()
          foo.stdin.once('drain', () => gs.stdout.resume())
        }
      })
      gs.stdout.on('end', () => foo.stdin.end())
      gs.stderr.on('data', (d) => { gsErr += d })
      foo.stderr.on('data', (d) => { fooErr += d })
      foo.stdout.pipe(out)
      foo.stdin.on('error', () => {}) // reported via exit codes below

      // Settle only once Ghostscript, foo2zjs AND the output file are done
      const finish = () => {
        if (settled || gsCode === null || fooCode === null || !outDone) return
        settled = true
        if (gsCode !== 0) {
          return reject(new PrinterError('RENDER_FAILED', `Could not render document (Ghostscript ${gsCode}): ${gsErr.trim().slice(0, 300)}`))
        }
        if (fooCode !== 0) {
          return reject(new PrinterError('ENCODE_FAILED', `Printer encoding failed (foo2zjs ${fooCode}): ${fooErr.trim().slice(0, 300)}`))
        }
        const pages = Math.round(rasterBytes / PBM_PAGE_BYTES)
        if (pages < 1) return reject(new PrinterError('RENDER_FAILED', 'Document rendered to zero pages'))
        resolve({ pages, bytes: fs.statSync(zjsPath).size })
      }
      gs.on('close', (code) => { gsCode = code; finish() })
      foo.on('close', (code) => { fooCode = code; finish() })
      out.on('close', () => { outDone = true; finish() })
      const fail = (err) => { if (!settled) { settled = true; gs.kill(); foo.kill(); reject(err) } }
      gs.on('error', (e) => fail(new PrinterError('RENDER_FAILED', `Ghostscript not available: ${e.message}`)))
      foo.on('error', (e) => fail(new PrinterError('ENCODE_FAILED', `foo2zjs not available: ${e.message}`)))
    })
  }

  /** Send one rendered copy. `sentBefore` = bytes of earlier copies. */
  async sendCopy(zjsPath, sentBefore) {
    const res = await this.usb('-t 90000 send', { input: zjsPath, timeoutMs: 15 * 60 * 1000 })
    const m = /sent (\d+) bytes/.exec(res.stderr)
    const sent = m ? Number(m[1]) : 0
    if (res.code === 0) return sent

    const anySent = sentBefore + sent > 0
    if (res.code === 2) throw new PrinterError('PRINTER_NOT_FOUND', 'Printer disconnected during printing', anySent)
    if (res.code === 3) {
      throw new PrinterError('PRINTER_STALLED', 'Printer stopped accepting data (paper jam, out of paper or power loss)', anySent)
    }
    throw new PrinterError('USB_ERROR', `USB error: ${res.stderr.trim().slice(0, 200)}`, anySent)
  }

  /**
   * Wait out the physical print and check the printer is healthy afterwards.
   * Returns evidence; throws if the printer reports paper-out/error.
   */
  async waitForPrint(sheets, log) {
    const expectedMs = (WARMUP_SECONDS + sheets * SECONDS_PER_PAGE) * 1000
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

module.exports = { ZjsUsbPrinter, PrinterError }
