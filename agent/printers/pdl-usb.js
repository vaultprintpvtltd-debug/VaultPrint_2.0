// ---------------------------------------------------------------------------
// Page-description-language printers over USB — PCL, PCL XL or PostScript.
//
// Most office lasers (e.g. the CWC 4055 series, IEEE-1284
// "CMD:ACL,PJL,PL,PCL,PCLXL,PS3,PDF") render pages themselves, so the box
// only converts the PDF into a language the printer speaks:
//
//   PDF ─ Ghostscript (pxlmono / pxlcolor, or ps2write) ─▶ vp-usbprint ─▶ USB
//
// The whole job is rendered before sending, so the printer never waits for
// data mid-page. Copies are sent as repeated jobs, like the other backends.
// Completion is INFERRED: every byte accepted and the printer healthy after
// the expected print time (no page counter is read).
// ---------------------------------------------------------------------------

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const { PrinterError } = require('./zjs-usb')
const { rootShell } = require('./rootcmd')

const RES = 600
// After the last byte the printer still prints what it has buffered (a
// laser holds whole pages): a few seconds per sheet, ~25 ppm
const TAIL_SECONDS = 8
const SECONDS_PER_SHEET = 3

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
    // The child can exit before taking all its input (printer unplugged)
    child.stdin.on('error', () => {})
    if (input) {
      const src = fs.createReadStream(input)
      src.on('error', (err) => { stderr += String(err); child.kill('SIGKILL') })
      src.pipe(child.stdin)
    } else child.stdin.end()
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class PdlUsbPrinter {
  /**
   * @param {object} o
   * @param {string} o.binDir   directory holding vp-usbprint
   * @param {string} o.device   USB VID:PID
   * @param {string[]} o.languages what the printer speaks: any of 'pcl', 'pxl', 'ps'
   */
  constructor({ binDir, device, languages = ['pxl'], language, gs = 'gs' }) {
    this.binDir = binDir
    this.device = device
    this.languages = language ? [language] : languages
    this.gs = gs
    this.shell = rootShell()
    this.lastStatus = null
  }

  usb(args, opts) {
    const cmd = `${path.join(this.binDir, 'vp-usbprint')} -d ${this.device} ${args}`
    return run(this.shell[0], [...this.shell[1], cmd], opts)
  }

  selfCheck() {
    const f = path.join(this.binDir, 'vp-usbprint')
    if (!fs.existsSync(f)) throw new Error(`PDL backend missing: ${f}`)
  }

  /** Current printer state. Never throws. */
  async probe() {
    const id = await this.usb('id', { timeoutMs: 15000 })
    if (id.code === 2) return (this.lastStatus = { present: false, firmware_loaded: false, ready: false })
    // 5 = another vp-usbprint is using it (a job being sent): present and busy
    if (id.code === 5) return (this.lastStatus = { ...(this.lastStatus || {}), present: true, firmware_loaded: true, ready: true, busy: true })
    if (id.code !== 0) return (this.lastStatus = { present: true, firmware_loaded: false, ready: false, error: true, detail: id.stderr.trim() })
    const model = /MDL:([^;]+)/.exec(id.stdout)
    // No firmware to load: "loaded" means it answered its device ID
    const state = { present: true, firmware_loaded: true, model: model ? model[1] : null }
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

  async ensureFirmware() {
    const state = await this.probe()
    if (!state.present) throw new PrinterError('PRINTER_NOT_FOUND', 'Printer not connected or powered off')
    return state
  }

  /** PDF → printer language file. Resolves { pages, bytes }. */
  render(pdfPath, job, outPath) {
    return new Promise((resolve, reject) => {
      const colour = job.color_mode === 'colour'
      // B&W: PCL raster (ljet4) whenever the printer speaks PCL. The page is
      // drawn on the box at 600 dpi and compressed, so its size is bounded
      // (a phone photo: 1.8 MB) — PCL XL/PostScript pass photos through at
      // full camera resolution (159 MB for one page: the printer stalls).
      // Colour (colour lasers only): PCL XL colour.
      const has = (l) => this.languages.includes(l)
      const device =
        colour && has('pxl') ? 'pxlcolor'
          : has('pcl') ? (job.duplex ? 'ljet4d' : 'ljet4')
            : has('pxl') ? 'pxlmono'
              : 'ps2write'
      // Not -q: Ghostscript then prints "Page N" per page, which we count
      const args = [
        '-dBATCH', '-dSAFER', '-dNOPAUSE',
        `-sDEVICE=${device}`, `-r${RES}`,
        '-sPAPERSIZE=a4', '-dFIXEDMEDIA', '-dPDFFitPage',
      ]
      if (job.duplex && device !== 'ljet4d') args.push('-dDuplex=true', '-dTumble=false')
      if (job.pages_to_print && job.pages_to_print !== 'all') {
        if (!/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(job.pages_to_print)) {
          return reject(new PrinterError('INVALID_PAGE_RANGE', `Invalid page range "${job.pages_to_print}"`))
        }
        args.push(`-sPageList=${job.pages_to_print}`)
      }
      args.push(`-sOutputFile=${outPath}`, '--', pdfPath)

      const gs = spawn(this.gs, args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      gs.stdout.on('data', (d) => { out += d })
      gs.stderr.on('data', (d) => { err += d })
      gs.on('error', (e) => reject(new PrinterError('RENDER_FAILED', `Ghostscript not available: ${e.message}`)))
      gs.on('close', (code) => {
        if (code !== 0) {
          return reject(new PrinterError('RENDER_FAILED', `Could not render document (Ghostscript ${code}): ${(err || out).trim().slice(0, 300)}`))
        }
        const pages = (out.match(/^Page \d+/gm) || []).length
        if (pages < 1 || !fs.existsSync(outPath)) return reject(new PrinterError('RENDER_FAILED', 'Document rendered to zero pages'))
        resolve({ pages, bytes: fs.statSync(outPath).size })
      })
    })
  }

  async sendCopy(jobPath, sentBefore) {
    const res = await this.usb('-t 120000 send', { input: jobPath, timeoutMs: 20 * 60 * 1000 })
    const m = /sent (\d+) bytes/.exec(res.stderr)
    const sent = m ? Number(m[1]) : 0
    if (res.code === 0) return sent
    const anySent = sentBefore + sent > 0
    if (res.code === 2) throw new PrinterError('PRINTER_NOT_FOUND', 'Printer disconnected during printing', anySent)
    if (res.code === 3) throw new PrinterError('PRINTER_STALLED', 'Printer stopped accepting data (out of paper, paper jam or power loss)', anySent)
    throw new PrinterError('USB_ERROR', `USB error: ${res.stderr.trim().slice(0, 200)}`, anySent)
  }

  async waitForPrint(sheets, log) {
    const expectedMs = (TAIL_SECONDS + SECONDS_PER_SHEET * Math.min(sheets, 20)) * 1000
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
    for (let i = 0; i < 5 && !(state && state.ready); i++) {
      await sleep(2000)
      state = await this.probe()
    }
    if (!state || !state.ready) throw new PrinterError('PRINTER_ERROR', 'Printer not ready after printing (check for a jam)', true)
    return { waited_ms: Date.now() - started, final_status: state }
  }
}

module.exports = { PdlUsbPrinter }
