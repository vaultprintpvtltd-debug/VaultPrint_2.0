import Image from 'next/image'
import React from 'react'

export default function UserLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col font-jakarta bg-[#F8FAFC] text-zinc-900 overflow-hidden">
      
      {/* Background SVG */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <Image 
          src="/background_mobile.svg" 
          alt="background" 
          fill 
          className="object-cover opacity-60" 
          priority 
        />
      </div>

      {/* Centered Mobile App Container */}
      <div className="relative z-10 flex flex-col flex-1 w-full max-w-md sm:max-w-lg mx-auto">
        {/* Header */}
        <header className="flex w-full items-center justify-between px-4 sm:px-6 py-4 sm:py-5">
          <div className="flex items-center gap-3 rounded-full bg-white/70 backdrop-blur-md px-4 sm:px-5 py-2 sm:py-2.5 shadow-sm border border-white/20">
            <Image 
              src="/LOGO.svg" 
              alt="VaultPrint" 
              width={120} 
              height={24} 
              className="h-5 sm:h-6 w-auto" 
              style={{ width: 'auto' }}
              priority
            />
            <span className="font-bold text-lg sm:text-xl text-navy tracking-tight leading-none">VaultPrint</span>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex flex-1 flex-col px-4 sm:px-6 pb-6 lg:pb-12">
          {children}
        </main>
      </div>

    </div>
  )
}
