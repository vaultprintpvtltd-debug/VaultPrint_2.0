export async function sendOTPEmail(): Promise<void> {
  // stub
}

export async function sendReceiptEmail(): Promise<void> {
  // stub
}

// ---------------------------------------------------------------------------
// POS reconciliation (Mode 2, PRD D4) — new function, existing ones untouched.
// Sends the daily per-kiosk POS settlement report via AWS SES.
// Requires env: AWS_REGION (or AWS SES defaults), SES_FROM_EMAIL, ADMIN_EMAIL.
// If SES env is missing, logs the report instead of throwing so the cron
// route never fails the whole run.
// ---------------------------------------------------------------------------

export interface PosReconciliationKiosk {
  kiosk_name: string
  job_count: number
  total_amount: number
  receipt_refs: string[]
}

export interface PosDiscrepancyEvent {
  job_id: string
  kiosk_name: string
  total_price: number | null
  client_amount: number | null
  created_at: string
}

export async function sendPosReconciliationEmail(
  reportDate: string,
  kiosks: PosReconciliationKiosk[],
  discrepancies: PosDiscrepancyEvent[]
): Promise<{ sent: boolean }> {
  const from = process.env.SES_FROM_EMAIL
  const to = process.env.ADMIN_EMAIL

  const lines: string[] = [
    `VaultPrint — POS reconciliation for ${reportDate}`,
    '',
    ...kiosks.map(
      (k) =>
        `${k.kiosk_name}: ${k.job_count} completed POS job(s), ₹${k.total_amount.toFixed(2)}\n` +
        `  receipt refs: ${k.receipt_refs.length ? k.receipt_refs.join(', ') : '(none)'}`
    ),
    '',
    kiosks.length === 0 ? 'No completed POS jobs today.' : '',
    discrepancies.length
      ? [
          '⚠ AMOUNT DISCREPANCIES:',
          ...discrepancies.map(
            (d) =>
              `  job ${d.job_id} @ ${d.kiosk_name}: job total ₹${d.total_price ?? '?'} vs client ₹${d.client_amount ?? '?'} (${d.created_at})`
          ),
        ].join('\n')
      : 'No amount discrepancies recorded.',
    '',
    'Compare against each POS terminal\'s daily settlement report.',
  ]
  const body = lines.filter((l) => l !== '').join('\n')

  if (!from || !to) {
    // TODO(deploy): set SES_FROM_EMAIL and ADMIN_EMAIL (and AWS credentials)
    console.warn(
      '[email] SES_FROM_EMAIL / ADMIN_EMAIL not configured — reconciliation report:\n' + body
    )
    return { sent: false }
  }

  const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses')
  const ses = new SESClient({})
  await ses.send(
    new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: `VaultPrint POS reconciliation — ${reportDate}` },
        Body: { Text: { Data: body } },
      },
    })
  )
  return { sent: true }
}
