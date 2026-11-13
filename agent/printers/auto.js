// ---------------------------------------------------------------------------
// PRINT_BACKEND=auto — find the kiosk's USB printer(s) and pick backends.
//
// The same agent runs on every kiosk; nobody types printer settings. Each
// attached printer is identified from its IEEE-1284 device ID:
//
//   HP LaserJet 1020 (03f0:2b17, ZjStream)  → zjs-usb        (needs firmware file)
//   CMD contains BJRaster (Canon inkjets)    → gutenprint-usb (colour)
//   CMD contains PCL / PCLXL / PostScript     → pdl-usb (B&W as PCL raster
//                                               when possible — see pdl-usb.js)
//
// ONE printer (the usual kiosk): every job goes to it — B&W and colour.
//
// TWO OR MORE printers: jobs are routed by colour mode —
//   colour → the colour printer (an inkjet), B&W → a laser if there is one.
//   Override with PRINTER_BW=<vid:pid> / PRINTER_COLOUR=<vid:pid> in .env.
// The heartbeat then also reports each mode's printer state (by_mode), so a
// switched-off colour printer blocks only colour payments.
//
// Unplugged / swapped printers are detected again on the next probe.
// ---------------------------------------------------------------------------

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { ZjsUsbPrinter, PrinterError } = require('./zjs-usb')
const { GutenprintUsbPrinter } = require('./gutenprint-usb')
const { PdlUsbPrinter } = require('./pdl-usb')
const { rootShell } = require('./rootcmd')

const SYSFS = '/sys/bus/usb/devices'
const REDETECT_MS = 15000
const ZJS_IDS = new Set(['03f0:2b17']) // HP LaserJet 1020 (verified)

function read(p) {
  try { return fs.readFileSync(p, 'utf8').trim() } catch { return null }
}

/** VID:PID of every USB device exposing a printer-class (07) interface. */
function listUsbPrinters() {
  const found = new Set()
  let entries = []
  try { entries = fs.readdirSync(SYSFS) } catch { return [] }
  for (const e of entries.sort()) {
    if (!e.includes(':')) continue // interfaces are "<dev>:<cfg>.<if>"
    if (read(path.join(SYSFS, e, 'bInterfaceClass')) !== '07') continue
    const dev = e.split(':')[0]
    const vid = read(path.join(SYSFS, dev, 'idVendor'))
    const pid = read(path.join(SYSFS, dev, 'idProduct'))
    if (vid && pid) found.add(`${vid}:${pid}`.toLowerCase())
  }
  return [...found]
}

function deviceId(binDir, device) {
  return new Promise((resolve) => {
    const [sh, pre] = rootShell()
    const child = spawn(sh, [...pre, `${path.join(binDir, 'vp-usbprint')} -d ${device} id`], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000)
    child.stdout.on('data', (d) => { out += d })
    child.on('error', () => { clearTimeout(timer); resolve(null) })
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0 ? out.trim() : null) })
  })
}

const OFFLINE = { present: false, firmware_loaded: false, ready: false }

class AutoPrinter {
  constructor({ binDir, firmwarePath, log = () => {}, bwDevice, colourDevice }) {
    this.binDir = binDir
    this.firmwarePath = firmwarePath
    this.log = log
    this.bwDevice = (bwDevice || process.env.PRINTER_BW || '').toLowerCase() || null
    this.colourDevice = (colourDevice || process.env.PRINTER_COLOUR || '').toLowerCase() || null
    this.printers = [] // [{ device, kind, model, colour, impl }]
    this.lastDetect = 0
    this.lastSummary = ''
    this._lastStatus = null
  }

  get lastStatus() { return this._lastStatus }

  selfCheck() {
    const f = path.join(this.binDir, 'vp-usbprint')
    if (!fs.existsSync(f)) throw new Error(`Printer helper missing: ${f}`)
  }

  /** Identify one printer → { kind, model, colour, make } or null. */
  async identify(device) {
    if (ZJS_IDS.has(device)) {
      if (!this.firmwarePath || !fs.existsSync(this.firmwarePath)) {
        this.log(`Printer ${device} is an HP LaserJet 1020 but its firmware file is missing (${this.firmwarePath})`)
        return null
      }
      return { kind: 'zjs-usb', model: 'HP LaserJet 1020', colour: false,
        make: () => new ZjsUsbPrinter({ binDir: this.binDir, firmwarePath: this.firmwarePath, device }) }
    }
    const id = await deviceId(this.binDir, device)
    if (!id) return null
    const cmd = ((/CMD:([^;]*)/i.exec(id) || [])[1] || '').toUpperCase().split(',').map((s) => s.trim())
    const model = ((/MDL:([^;]*)/i.exec(id) || [])[1] || device).trim()
    if (cmd.some((c) => c.startsWith('BJRASTER'))) {
      return { kind: 'gutenprint-usb', model, colour: true,
        make: () => new GutenprintUsbPrinter({ binDir: this.binDir, device }) }
    }
    const languages = []
    if (cmd.some((c) => c === 'PCL' || c === 'PCL5' || c === 'PCL5E' || c === 'PCL5C')) languages.push('pcl')
    if (cmd.some((c) => c === 'PCLXL' || c === 'PCL XL' || c === 'PXL')) languages.push('pxl')
    if (cmd.some((c) => c === 'POSTSCRIPT' || c.startsWith('PS'))) languages.push('ps')
    if (languages.length) {
      return { kind: `pdl-usb:${languages.join('+')}`, model, colour: false,
        make: () => new PdlUsbPrinter({ binDir: this.binDir, device, languages }) }
    }
    this.log(`Printer ${device} (${model}) speaks ${cmd.join(',') || 'nothing known'} — not supported`)
    return null
  }

  /** Find every attached printer (keeps backends of printers still there). */
  async detect() {
    this.lastDetect = Date.now()
    const next = []
    for (const device of listUsbPrinters()) {
      const known = this.printers.find((p) => p.device === device)
      if (known) { next.push(known); continue }
      const info = await this.identify(device)
      if (info) next.push({ device, kind: info.kind, model: info.model, colour: info.colour, impl: info.make() })
    }
    this.printers = next
    const summary = this.describe()
    if (summary !== this.lastSummary) {
      this.log(summary)
      this.lastSummary = summary
    }
    return next
  }

  describe() {
    if (this.printers.length === 0) return 'No printer detected on USB'
    if (this.printers.length === 1) {
      const p = this.printers[0]
      return `Printer detected: ${p.model} (${p.device}) → ${p.kind}`
    }
    const bw = this.route('bw')
    const colour = this.route('colour')
    return `Printers detected: ${this.printers.map((p) => `${p.model} (${p.device}) → ${p.kind}`).join('; ')}` +
      ` | B&W jobs → ${bw ? bw.model : 'none'}, colour jobs → ${colour ? colour.model : 'none'}`
  }

  /** The printer for a colour mode ('bw' | 'colour'), or null. */
  route(mode) {
    const list = this.printers
    if (list.length === 0) return null
    if (list.length === 1) return list[0] // single printer: everything goes to it
    const wanted = mode === 'colour' ? this.colourDevice : this.bwDevice
    if (wanted) {
      const p = list.find((x) => x.device === wanted)
      if (p) return p
    }
    if (mode === 'colour') return list.find((x) => x.colour) || list[0]
    return list.find((x) => !x.colour) || list[0]
  }

  /**
   * Printer state for the heartbeat. With one printer: exactly that
   * printer's state (as before). With several: the B&W printer's state at
   * the top level, plus by_mode { bw, colour } for per-mode gating.
   */
  async probe() {
    const states = new Map()
    for (const p of this.printers) states.set(p.device, await p.impl.probe())
    const missing = this.printers.some((p) => !states.get(p.device).present)
    if (this.printers.length === 0 || missing || Date.now() - this.lastDetect > REDETECT_MS) {
      if (this.printers.length === 0 || missing || listUsbPrinters().length !== this.printers.length) {
        await this.detect()
        for (const p of this.printers) if (!states.has(p.device)) states.set(p.device, await p.impl.probe())
      } else {
        this.lastDetect = Date.now()
      }
    }
    if (this.printers.length === 0) return (this._lastStatus = { ...OFFLINE })

    const stateOf = (p) => (p ? { ...(states.get(p.device) || OFFLINE), model: p.model } : { ...OFFLINE })
    const bw = this.route('bw')
    if (this.printers.length === 1) return (this._lastStatus = stateOf(bw))
    const colour = this.route('colour')
    return (this._lastStatus = { ...stateOf(bw), by_mode: { bw: stateOf(bw), colour: stateOf(colour) } })
  }

  /** The backend that prints this job (by its colour mode). */
  async forJob(job) {
    const mode = job && job.color_mode === 'colour' ? 'colour' : 'bw'
    let p = this.route(mode)
    if (!p || !(await p.impl.probe()).present) {
      await this.detect()
      p = this.route(mode)
    }
    if (!p) throw new PrinterError('PRINTER_NOT_FOUND', `No ${mode === 'colour' ? 'colour ' : ''}printer connected or powered on`)
    return p.impl
  }

  // Single-printer style calls (kept for callers that don't use forJob)
  async ensureFirmware(log) { return (await this.forJob(null)).ensureFirmware(log) }
  async render(pdfPath, job, outPath) { return (await this.forJob(job)).render(pdfPath, job, outPath) }
  async sendCopy(file, sentBefore) { return (await this.forJob(null)).sendCopy(file, sentBefore) }
  async waitForPrint(sheets, log, job) { return (await this.forJob(job)).waitForPrint(sheets, log, job) }
}

module.exports = { AutoPrinter, listUsbPrinters }
