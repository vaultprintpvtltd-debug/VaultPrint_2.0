'use client'

import Image from 'next/image'

export default function KioskUploadPage() {
  return (
    <>
      <div className="rounded-3xl lg:rounded-[2.5rem] border border-white/10 bg-[#3a4354]/90 p-6 lg:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-2xl w-full max-w-[400px] lg:max-w-none mx-auto flex flex-col items-center justify-center transition-all duration-500 scale-100 opacity-100 aspect-square">
        <div className="rounded-xl bg-white/5 border border-white/10 p-8 flex flex-col items-center justify-center w-full h-full text-center gap-6 shadow-inner">
          <div className="relative h-24 w-24">
            <div className="absolute inset-0 bg-teal-400 rounded-full blur-xl opacity-20 animate-pulse" />
            <Image src="/file.svg" alt="Upload" width={96} height={96} className="relative z-10 opacity-80 filter invert" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white mb-2 tracking-wide">Select Your Files</h3>
            <p className="text-sm text-zinc-400 leading-relaxed max-w-[250px]">
              Please continue on your phone. Upload your PDFs and complete the payment to receive an OTP.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 lg:mt-8 flex flex-col items-center text-center transition-opacity duration-500 delay-200">
        <div className="flex items-center gap-2 text-zinc-300 text-sm lg:text-base bg-black/30 border border-teal-500/30 rounded-full px-5 lg:px-6 py-2.5 lg:py-3 shadow-inner backdrop-blur-md">
          <div className="h-2 w-2 lg:h-2.5 lg:w-2.5 rounded-full bg-teal-400 animate-pulse shadow-[0_0_8px_rgba(45,212,191,0.8)]" />
          <span className="tracking-wide text-teal-300">Waiting for upload...</span>
        </div>
      </div>
    </>
  )
}
