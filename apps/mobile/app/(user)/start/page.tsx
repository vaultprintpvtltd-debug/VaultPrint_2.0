import { redirect } from 'next/navigation'
import { createServerClient } from '@vaultprint/db/server'

// ---------------------------------------------------------------------------
// /start?k=[kioskId] — Session Creation Page (Server Component)
//
// This is the entry point when a user scans the kiosk QR code.
// It reads the ?k= param, directly interacts with the database to create
// a print_jobs session, and immediately redirects to /print/[sessionId].
// ---------------------------------------------------------------------------

interface StartPageProps {
  searchParams: Promise<{ k?: string }>
}

function renderError(title: string, message: string) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100 px-4">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
          <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-zinc-400">{message}</p>
        <p className="mt-6 text-sm text-zinc-600">
          Please scan the QR code again or try a different kiosk.
        </p>
      </div>
    </div>
  )
}

export default async function StartPage({ searchParams }: StartPageProps) {
  const params = await searchParams
  const kioskId = params.k

  if (!kioskId) {
    return renderError('Invalid Link', 'Please scan the QR code on the kiosk to start printing.')
  }

  const supabase = await createServerClient()

  // 1. Validate kiosk exists and is not offline
  const { data: kiosk, error: kioskError } = await supabase
    .from('kiosks')
    .select()
    .eq('id', kioskId)
    .single()

  if (kioskError || !kiosk) {
    return renderError('Kiosk Not Found', 'The QR code you scanned is invalid or the kiosk no longer exists.')
  }

  if (kiosk.status === 'offline') {
    return renderError('Kiosk Offline', 'This kiosk is currently offline. Please try another one.')
  }

  // 2. Create print_jobs session
  const { data: job, error: jobError } = await supabase
    .from('print_jobs')
    .insert({ kiosk_id: kiosk.id, status: 'created' })
    .select()
    .single()

  if (jobError || !job) {
    return renderError('Session Failed', 'We could not start a new print session right now.')
  }

  // 3. Log the event
  await supabase.from('audit_log').insert({
    job_id: job.id,
    kiosk_id: kiosk.id,
    event: 'session_created',
    actor: 'user',
    metadata: {},
  })

  // 4. Redirect to the upload page
  redirect(`/print/${job.session_id}`)
}
