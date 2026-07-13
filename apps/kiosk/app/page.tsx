import Image from 'next/image'

// ---------------------------------------------------------------------------
// / — Kiosk App root (kiosk.vaultprintpvtltd.online)
//
// In the field every kiosk machine opens /kiosk/[kioskId] directly, so the
// bare root is a fallback: it renders a branded "not configured" holding
// screen instead of the Next.js starter. Dark, full-screen, matches the
// (kiosk) display aesthetic.
// ---------------------------------------------------------------------------

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#0f1420] font-jakarta text-white">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 z-0 opacity-40">
        <Image src="/bg_kiosk.svg" alt="" fill className="object-cover" priority />
      </div>

      <div className="relative z-10 flex w-full max-w-xl flex-col items-center px-8 text-center">
        {/* Brand */}
        <div className="flex items-center gap-3 rounded-full border border-white/10 bg-[#3a4354]/80 px-6 py-3 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
          <Image
            src="/LOGO.svg"
            alt="VaultPrint"
            width={140}
            height={28}
            className="h-7 w-auto invert"
            style={{ width: 'auto' }}
            priority
          />
          <span className="text-2xl font-bold tracking-tight text-white">VaultPrint</span>
        </div>

        <div className="mt-10 flex items-center gap-2 rounded-full border border-teal-500/30 bg-black/30 px-5 py-2 text-sm text-teal-300 shadow-inner backdrop-blur-md">
          <span className="h-2 w-2 animate-pulse rounded-full bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.8)]" />
          Kiosk display
        </div>

        <h1 className="mt-8 text-4xl font-bold tracking-tight lg:text-5xl">
          This display isn&apos;t linked to a kiosk yet
        </h1>
        <p className="mt-5 max-w-md text-lg leading-relaxed text-zinc-400">
          Open this machine at its kiosk address to start serving prints:
        </p>

        <code className="mt-6 rounded-xl border border-white/10 bg-black/40 px-6 py-4 font-mono text-base text-teal-300 lg:text-lg">
          kiosk.vaultprintpvtltd.online/kiosk/<span className="text-zinc-500">&lt;kiosk-id&gt;</span>
        </code>

        <p className="mt-8 max-w-sm text-sm leading-relaxed text-zinc-500">
          The kiosk ID is issued from the admin panel when the kiosk is added to the fleet.
        </p>
      </div>
    </div>
  )
}
