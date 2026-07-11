export async function extractPageCount(): Promise<number> {
  return 1
}

/**
 * Parse PDF bytes with pdf-lib and return the page count.
 * Throws if the bytes are not a real, parseable PDF — this is the Mode 2
 * "fake PDF" security control (PRD C2.7 step 4): client MIME is advisory,
 * only a successful parse is trusted.
 */
export async function getPdfPageCount(
  bytes: Uint8Array | ArrayBuffer
): Promise<number> {
  const { PDFDocument } = await import('pdf-lib')
  // ignoreEncryption: false — encrypted PDFs cannot be printed reliably
  const doc = await PDFDocument.load(bytes)
  return doc.getPageCount()
}
