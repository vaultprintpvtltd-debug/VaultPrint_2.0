// ---------------------------------------------------------------------------
// PRINT_BACKEND=auto — find the USB printer and pick its backend.
//
// The same agent runs on every kiosk; nobody types printer settings. On each
// probe (heartbeat, before a job) the attached printer is identified from
// its IEEE-1284 device ID and the matching backend is used:
//
//   HP LaserJet 1020 (03f0:2b17, ZjStream)  → zjs-usb        (needs firmware file)
//   CMD contains BJRaster (Canon inkjets)    → gutenprint-usb (Canon G2000-series driver)
//   CMD contains PCLXL                        → pdl-usb, PCL XL
//   CMD contains POSTSCRIPT / PS              → pdl-usb, PostScript
//
// If the printer is unplugged or swapped, the next probe detects it again.
// ---------------------------------------------------------------------------

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { ZjsUsbPrinter } = require('./zjs-usb')
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
  for (const e of entries) {
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

class AutoPrinter {
  constructor({ binDir, firmwarePath, log = () => {} }) {
    this.binDir = binDir
    this.firmwarePath = firmwarePath
    this.log = log
    this.impl = null
    this.kind = null // 'zjs-usb' | 'gutenprint-usb' | 'pdl-usb:pxl' | 'pdl-usb:ps'
    this.device = null
    this.lastDetect = 0
    this._lastStatus = null
  }

  get lastStatus() { return this.impl ? this.impl.lastStatus : this._lastStatus }

  selfCheck() {
    const f = path.join(this.binDir, 'vp-usbprint')
    if (!fs.existsSync(f)) throw new Error(`Printer helper missing: ${f}`)
  }

  /** Pick a backend for the attached printer. Returns a description. */
  async detect() {
    this.lastDetect = Date.now()
    for (const device of listUsbPrinters()) {
      let kind = null
      let make = null
      if (ZJS_IDS.has(device)) {
        if (!this.firmwarePath || !fs.existsSync(this.firmwarePath)) {
          this.log(`Printer ${device} is an HP LaserJet 1020 but its firmware file is missing (${this.firmwarePath})`)
          continue
        }
        kind = 'zjs-usb'
        make = () => new ZjsUsbPrinter({ binDir: this.binDir, firmwarePath: this.firmwarePath, device })
      } else {
        const id = await deviceId(this.binDir, device)
        if (!id) continue
        const cmd = ((/CMD:([^;]*)/i.exec(id) || [])[1] || '').toUpperCase().split(',').map((s) => s.trim())
        const model = (/MDL:([^;]*)/i.exec(id) || [])[1] || device
        if (cmd.some((c) => c.startsWith('BJRASTER'))) {
          kind = 'gutenprint-usb'
          make = () => new GutenprintUsbPrinter({ binDir: this.binDir, device })
        } else if (cmd.some((c) => c === 'PCLXL' || c === 'PCL XL' || c === 'PXL')) {
          kind = 'pdl-usb:pxl'
          make = () => new PdlUsbPrinter({ binDir: this.binDir, device, language: 'pxl' })
        } else if (cmd.some((c) => c === 'POSTSCRIPT' || c.startsWith('PS'))) {
          kind = 'pdl-usb:ps'
          make = () => new PdlUsbPrinter({ binDir: this.binDir, device, language: 'ps' })
        } else {
          this.log(`Printer ${device} (${model}) speaks ${cmd.join(',') || 'nothing known'} — not supported`)
          continue
        }
        if (kind !== this.kind || device !== this.device) this.log(`Printer detected: ${model} (${device}) → ${kind}`)
      }
      if (kind !== this.kind || device !== this.device) {
        this.impl = make()
        this.kind = kind
        this.device = device
      }
      return kind
    }
    if (this.impl) this.log('Printer no longer detected on USB')
    this.impl = null
    this.kind = null
    this.device = null
    return null
  }

  async probe() {
    if (this.impl) {
      const state = await this.impl.probe()
      if (state.present) return state
    }
    // Not found (unplugged, switched off, swapped): look again, at most every few seconds
    if (!this.impl || Date.now() - this.lastDetect > REDETECT_MS) await this.detect()
    if (!this.impl) return (this._lastStatus = { present: false, firmware_loaded: false, ready: false })
    return this.impl.probe()
  }

  async require() {
    if (!this.impl) await this.detect()
    if (!this.impl) {
      const { PrinterError } = require('./zjs-usb')
      throw new PrinterError('PRINTER_NOT_FOUND', 'Printer not connected or powered off')
    }
    return this.impl
  }

  async ensureFirmware(log) { return (await this.require()).ensureFirmware(log) }
  async render(pdfPath, job, outPath) { return (await this.require()).render(pdfPath, job, outPath) }
  async sendCopy(file, sentBefore) { return (await this.require()).sendCopy(file, sentBefore) }
  async waitForPrint(sheets, log, job) { return (await this.require()).waitForPrint(sheets, log, job) }
}

module.exports = { AutoPrinter, listUsbPrinters }
