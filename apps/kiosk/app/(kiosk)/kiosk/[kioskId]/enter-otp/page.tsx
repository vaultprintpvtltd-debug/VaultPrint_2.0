'use client'

import { useState } from 'react'

export default function KioskEnterOTPPage() {
  const [otp, setOtp] = useState(['', '', '', '', '', ''])

  return (
    <>
      <div className="rounded-3xl lg:rounded-[2.5rem] border border-white/10 bg-[#3a4354]/90 p-6 lg:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-2xl w-full max-w-[400px] lg:max-w-none mx-auto flex flex-col items-center justify-center transition-all duration-500 scale-100 opacity-100 aspect-square">
        <div className="rounded-xl bg-white/5 border border-white/10 p-8 flex flex-col items-center justify-center w-full h-full text-center gap-6 shadow-inner">
          <div>
            <h3 className="text-xl font-bold text-white mb-2 tracking-wide">Enter OTP</h3>
            <p className="text-sm text-zinc-400 leading-relaxed max-w-[250px]">
              Please enter the 6-digit OTP shown on your mobile device to start printing.
            </p>
          </div>
          
          <div className="flex items-center gap-2 lg:gap-3">
            {otp.map((digit, index) => (
              <input
                key={index}
                type="text"
                maxLength={1}
                value={digit}
                readOnly
                className="w-10 h-12 lg:w-12 lg:h-14 text-center text-xl lg:text-2xl font-bold font-jakarta text-teal-400 bg-black/40 border border-white/10 rounded-lg focus:outline-none focus:border-teal-400 shadow-inner"
              />
            ))}
          </div>

          <div className="mt-4">
            <button className="px-8 py-3 bg-teal-500 hover:bg-teal-400 text-white font-semibold rounded-full shadow-[0_0_15px_rgba(45,212,191,0.4)] transition-all uppercase tracking-wider text-sm">
              Verify
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6 lg:mt-8 flex flex-col items-center text-center transition-opacity duration-500 delay-200">
        <div className="flex items-center gap-2 text-zinc-300 text-sm lg:text-base bg-black/30 border border-teal-500/30 rounded-full px-5 lg:px-6 py-2.5 lg:py-3 shadow-inner backdrop-blur-md">
          <div className="h-2 w-2 lg:h-2.5 lg:w-2.5 rounded-full bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
          <span className="tracking-wide text-amber-300">Ready to Print</span>
        </div>
      </div>
    </>
  )
}
