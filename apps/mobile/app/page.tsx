import Image from 'next/image'

// ---------------------------------------------------------------------------
// / — Mobile App landing (app.vaultprintpvtltd.online)
//
// Users normally arrive at /start?k=[kioskId] by scanning a kiosk QR, so the
// bare root has no kiosk context. This page explains what VaultPrint is and
// directs the visitor to scan a kiosk QR to begin. Branded, mobile-first,
// matches the (user) design system (navy / glass on #F8FAFC).
// ---------------------------------------------------------------------------

const FEATURES = [
  { title: 'No app to install', body: 'Everything runs in your phone browser — scan and go.' },
  { title: 'No account needed', body: 'No sign-up, no login. Start printing in seconds.' },
  { title: 'Private by design', body: 'Your file is never seen by staff — only your one-time PIN releases the print.' },
]

const STEPS = [
  'Scan the QR code shown on a VaultPrint kiosk',
  'Upload your PDF and choose your print options',
  'Pay securely, then enter your PIN at the kiosk to collect',
]

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#F8FAFC] font-jakarta text-zinc-900">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <Image
          src="/background_mobile.svg"
          alt=""
          fill
          className="object-cover opacity-60"
          priority
        />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col px-5 py-8 sm:max-w-lg">
        {/* Brand */}
        <div className="flex items-center gap-3 self-start rounded-full border border-white/20 bg-white/70 px-5 py-2.5 shadow-sm backdrop-blur-md">
          <Image
            src="/LOGO.svg"
            alt="VaultPrint"
            width={120}
            height={24}
            className="h-6 w-auto"
            style={{ width: 'auto' }}
            priority
          />
          <span className="text-xl font-bold leading-none tracking-tight text-navy">VaultPrint</span>
        </div>

        {/* Hero */}
        <div className="mt-12">
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-navy">
            Printing, as easy as
            <span className="text-brand-blue"> sending a message.</span>
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-zinc-600">
            Self-service document printing from your phone — private, instant, no strings attached.
          </p>
        </div>

        {/* Call to action */}
        <div className="mt-8 rounded-3xl border border-white/60 bg-white/70 p-6 shadow-[0_20px_50px_rgba(30,58,138,0.08)] backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-blue/10 text-brand-blue">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm12 2h4m-4 4h4m-8-4v4" />
              </svg>
            </span>
            <div>
              <p className="font-bold text-navy">Scan a kiosk to begin</p>
              <p className="text-sm text-zinc-500">Point your camera at the QR code on any VaultPrint kiosk.</p>
            </div>
          </div>

          <ol className="mt-5 space-y-3">
            {STEPS.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">
                  {i + 1}
                </span>
                <span className="text-sm leading-relaxed text-zinc-700">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* Features */}
        <div className="mt-8 grid gap-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-white/60 bg-white/50 p-4 backdrop-blur-md"
            >
              <p className="font-semibold text-navy">{f.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-zinc-600">{f.body}</p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <footer className="mt-auto pt-10 text-center text-xs text-zinc-400">
          © {new Date().getFullYear()} VaultPrint · Secure kiosk printing
        </footer>
      </div>
    </div>
  )
}
