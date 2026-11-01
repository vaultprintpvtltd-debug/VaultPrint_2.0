// ---------------------------------------------------------------------------
// Upload conversion — everything is normalised to PDF at upload time, so the
// print agent only ever receives a PDF and the customer waits once, before
// paying (never at the kiosk).
//
//   PDF        → stored as-is
//   JPG / PNG  → one A4 page per image via pdf-lib (in-process, ~100 ms),
//                EXIF orientation honoured so phone photos aren't sideways
//   DOC / DOCX → LibreOffice via a Gotenberg service (GOTENBERG_URL),
//                typically 1–3 s warm. Disabled when GOTENBERG_URL is unset.
// ---------------------------------------------------------------------------

import { PDFDocument, degrees } from 'pdf-lib'

export type UploadKind = 'pdf' | 'image' | 'office'

interface UploadType {
  ext: string
  kind: UploadKind
  mime: string
}

const UPLOAD_TYPES: Record<string, UploadType> = {
  pdf: { ext: 'pdf', kind: 'pdf', mime: 'application/pdf' },
  jpg: { ext: 'jpg', kind: 'image', mime: 'image/jpeg' },
  jpeg: { ext: 'jpeg', kind: 'image', mime: 'image/jpeg' },
  png: { ext: 'png', kind: 'image', mime: 'image/png' },
  docx: {
    ext: 'docx',
    kind: 'office',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  doc: { ext: 'doc', kind: 'office', mime: 'application/msword' },
}

export function isOfficeConversionEnabled(): boolean {
  return Boolean(process.env.GOTENBERG_URL)
}

/** File extensions currently accepted for upload. */
export function acceptedUploadExtensions(): string[] {
  return Object.values(UPLOAD_TYPES)
    .filter((t) => t.kind !== 'office' || isOfficeConversionEnabled())
    .map((t) => t.ext)
}

/** Resolve an upload type from a file name; null when unsupported. */
export function getUploadType(fileName: string): UploadType | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  const type = UPLOAD_TYPES[ext]
  if (!type) return null
  if (type.kind === 'office' && !isOfficeConversionEnabled()) return null
  return type
}

/** Convert an accepted non-PDF upload to PDF bytes. */
export async function convertToPdf(
  bytes: Uint8Array,
  type: UploadType,
  fileName: string
): Promise<Uint8Array> {
  if (type.kind === 'image') return imageToPdf(bytes, type.mime)
  if (type.kind === 'office') return officeToPdf(bytes, fileName, type.ext)
  return bytes
}

// ─── Images ──────────────────────────────────────────────────────────────────

const A4_SHORT = 595.28
const A4_LONG = 841.89
// LaserJet-class printers cannot print the outer ~4 mm; keep a safe margin
const MARGIN = 18

async function imageToPdf(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const image = mime === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
  const orientation = mime === 'image/jpeg' ? readJpegOrientation(bytes) : 1
  const quarterTurn = orientation >= 5 // 5–8 swap width and height

  // Displayed (upright) image size, in image pixels
  const shownW = quarterTurn ? image.height : image.width
  const shownH = quarterTurn ? image.width : image.height

  const landscape = shownW > shownH
  const pageW = landscape ? A4_LONG : A4_SHORT
  const pageH = landscape ? A4_SHORT : A4_LONG
  const page = pdf.addPage([pageW, pageH])

  const scale = Math.min((pageW - 2 * MARGIN) / shownW, (pageH - 2 * MARGIN) / shownH)
  const drawW = image.width * scale
  const drawH = image.height * scale
  // Bottom-left of the upright box, centred on the page
  const bx = (pageW - shownW * scale) / 2
  const by = (pageH - shownH * scale) / 2

  // pdf-lib rotates counter-clockwise about (x, y)
  if (orientation === 3 || orientation === 4) {
    page.drawImage(image, { x: bx + drawW, y: by + drawH, width: drawW, height: drawH, rotate: degrees(180) })
  } else if (orientation === 6 || orientation === 5) {
    page.drawImage(image, { x: bx, y: by + drawW, width: drawW, height: drawH, rotate: degrees(-90) })
  } else if (orientation === 8 || orientation === 7) {
    page.drawImage(image, { x: bx + drawH, y: by, width: drawW, height: drawH, rotate: degrees(90) })
  } else {
    page.drawImage(image, { x: bx, y: by, width: drawW, height: drawH })
  }

  return pdf.save()
}

/** EXIF orientation (1–8) of a JPEG; 1 when absent or unreadable. */
function readJpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1

  let offset = 2
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return 1
    const marker = view.getUint8(offset + 1)
    const length = view.getUint16(offset + 2)
    if (marker === 0xda) return 1 // start of scan — no EXIF before image data

    // APP1 "Exif\0\0"
    if (marker === 0xe1 && offset + 10 <= view.byteLength && view.getUint32(offset + 4) === 0x45786966) {
      const tiff = offset + 10
      if (tiff + 8 > view.byteLength) return 1
      const little = view.getUint16(tiff) === 0x4949
      const ifd = tiff + view.getUint32(tiff + 4, little)
      if (ifd + 2 > view.byteLength) return 1
      const entries = view.getUint16(ifd, little)
      for (let i = 0; i < entries; i++) {
        const entry = ifd + 2 + i * 12
        if (entry + 12 > view.byteLength) return 1
        if (view.getUint16(entry, little) === 0x0112) {
          const value = view.getUint16(entry + 8, little)
          return value >= 1 && value <= 8 ? value : 1
        }
      }
      return 1
    }
    offset += 2 + length
  }
  return 1
}

// ─── Office documents (Gotenberg / LibreOffice) ──────────────────────────────

const OFFICE_TIMEOUT_MS = 45_000

async function officeToPdf(bytes: Uint8Array, fileName: string, ext: string): Promise<Uint8Array> {
  const baseUrl = process.env.GOTENBERG_URL
  if (!baseUrl) throw new Error('Word document conversion is not configured')

  const headers: Record<string, string> = {}
  if (process.env.GOTENBERG_USERNAME && process.env.GOTENBERG_PASSWORD) {
    const credentials = `${process.env.GOTENBERG_USERNAME}:${process.env.GOTENBERG_PASSWORD}`
    headers.Authorization = `Basic ${Buffer.from(credentials).toString('base64')}`
  }

  // LibreOffice picks the importer from the extension; the original name is
  // never sent (it may contain personal information).
  const form = new FormData()
  form.append('files', new Blob([bytes as BlobPart]), `document.${ext}`)

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/forms/libreoffice/convert`, {
    method: 'POST',
    headers,
    body: form,
    signal: AbortSignal.timeout(OFFICE_TIMEOUT_MS),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Conversion service failed for ${fileName} (HTTP ${res.status}) ${detail.slice(0, 200)}`)
  }

  return new Uint8Array(await res.arrayBuffer())
}
