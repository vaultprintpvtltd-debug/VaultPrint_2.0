'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
  Switch,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@vaultprint/ui'

// ---------------------------------------------------------------------------
// /customize/[sessionId] — Print Settings Page
// ---------------------------------------------------------------------------

interface PriceInfo {
  price_per_page: number
  billable_pages: number
  total_price: number
}

export default function CustomizePage() {
  const params = useParams<{ sessionId: string }>()
  const router = useRouter()
  const sessionId = params.sessionId

  // Core settings synced with backend pricing
  const [colorMode, setColorMode] = useState<'bw' | 'colour'>('bw')
  const [copies, setCopies] = useState(1)
  const [duplex, setDuplex] = useState(false)
  const [orientation, setOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto')
  const [pagesToPrint, setPagesToPrint] = useState('all')
  const [paperSize] = useState('A4')
  const [pagesInput, setPagesInput] = useState('')

  // Advanced settings
  const [isCollated, setIsCollated] = useState(true)
  const [pagesPerSheet, setPagesPerSheet] = useState(1)
  const [pageOrder, setPageOrder] = useState('horizontal')
  const [border, setBorder] = useState(false)
  const [quality, setQuality] = useState('standard')
  const [fitScale, setFitScale] = useState('fit')

  // Job info
  const [totalPages, setTotalPages] = useState<number | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  // Price
  const [price, setPrice] = useState<PriceInfo | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  // Save settings to the backend (which recalculates the price). Takes an
  // explicit settings object so the callback does NOT close over each setting
  // value — its identity stays stable (deps: sessionId, paperSize), which the
  // React Compiler can memoize cleanly.
  const saveSettings = useCallback(
    async (settings: {
      color_mode: string
      copies: number
      duplex: boolean
      orientation: string
      pages_to_print: string
      is_collated: boolean
      pages_per_sheet: number
      page_order: string
      border: boolean
      quality: string
      fit_scale: string
    }) => {
      setSaving(true)
      setError(null)
      try {
        const res = await fetch(`/api/jobs/${sessionId}/settings`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...settings, paper_size: paperSize }),
        })

        if (!res.ok) {
          const data = await res.json()
          setError(data.error || 'Failed to save settings')
          return
        }

        const data = await res.json()
        setPrice({
          price_per_page: data.price_per_page,
          billable_pages: data.billable_pages,
          total_price: data.total_price,
        })
      } catch {
        setError('Network error saving settings')
      } finally {
        setSaving(false)
      }
    },
    [sessionId, paperSize]
  )

  // Fetch job info on mount
  useEffect(() => {
    async function fetchJob() {
      try {
        const res = await fetch(`/api/jobs/${sessionId}/status`)
        if (!res.ok) return
        const data = await res.json()
        setTotalPages(data.total_pages)
        setFileName(data.file_name)

        if (!data.settings) {
          await saveSettings({
            color_mode: 'bw', copies: 1, duplex: false, orientation: 'auto',
            pages_to_print: 'all', is_collated: true, pages_per_sheet: 1,
            page_order: 'horizontal', border: false, quality: 'standard', fit_scale: 'fit',
          })
        }
        setLoaded(true)
      } catch {
        setError('Failed to load session')
      }
    }
    fetchJob()
  }, [sessionId, saveSettings])

  // Debounced save whenever a setting changes (after initial load)
  useEffect(() => {
    if (!loaded) return
    const timer = setTimeout(() => {
      saveSettings({
        color_mode: colorMode, copies, duplex, orientation, pages_to_print: pagesToPrint,
        is_collated: isCollated, pages_per_sheet: pagesPerSheet, page_order: pageOrder,
        border, quality, fit_scale: fitScale,
      })
    }, 400)
    return () => clearTimeout(timer)
  }, [colorMode, copies, duplex, orientation, pagesToPrint, isCollated, pagesPerSheet, pageOrder, border, quality, fitScale, loaded, saveSettings])

  const steps = [
    { id: 1, name: 'Upload', active: false },
    { id: 2, name: 'Settings', active: true },
    { id: 3, name: 'Payment', active: false },
    { id: 4, name: 'OTP', active: false },
  ]

  return (
    <div className="flex flex-col flex-1 w-full max-w-lg mx-auto relative h-full">
      
      {/* Mobile Stepper */}
      <div className="mt-2 mb-2 px-2 shrink-0">
        <div className="flex items-center justify-between relative">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-white/50 rounded-full z-0"></div>
          {steps.map((step) => (
            <div key={step.id} className="relative z-10 flex flex-col items-center gap-2">
              <div className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold transition-colors ${
                step.active 
                  ? 'bg-brand-blue text-white shadow-md ring-4 ring-white/50' 
                  : step.id < 2 
                    ? 'bg-emerald-500 text-white' 
                    : 'bg-white text-zinc-400 border border-zinc-200'
              }`}>
                {step.id < 2 ? '✓' : step.id}
              </div>
              <span className={`text-[10px] sm:text-xs font-semibold ${step.active ? 'text-navy' : step.id < 2 ? 'text-emerald-600' : 'text-zinc-400'}`}>
                {step.name}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Main Scrollable Area */}
      <div className="flex-1 overflow-y-auto pb-32 no-scrollbar px-1">
        
        {/* PDF Preview Placeholder Card */}
        <div className="mt-4 flex flex-col bg-white/40 backdrop-blur-2xl border border-white/60 shadow-[0_8px_32px_0_rgba(31,38,135,0.05)] rounded-2xl p-4 relative overflow-hidden mb-6">
           <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/30 to-transparent pointer-events-none rounded-t-2xl"></div>
           <div className="flex items-center justify-between mb-3 relative z-10">
             <h2 className="text-sm font-bold text-navy">Document Preview</h2>
             <span className="text-xs font-semibold bg-white/60 px-2 py-1 rounded-md text-brand-blue">{totalPages || '-'} Pages</span>
           </div>
           <div className="w-full h-40 bg-zinc-100/50 rounded-xl border border-white/50 flex items-center justify-center relative z-10 shadow-inner">
             <div className="flex flex-col items-center gap-2 opacity-60">
               <svg className="w-8 h-8 text-brand-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
               </svg>
               <span className="text-xs font-semibold text-navy max-w-[200px] truncate">{fileName || 'document.pdf'}</span>
             </div>
           </div>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/20 bg-red-50/80 backdrop-blur-md px-4 py-3 text-sm text-red-600 font-medium shadow-sm">
            {error}
          </div>
        )}

        <Accordion type="multiple" defaultValue={['item-1', 'item-2', 'item-3', 'item-4']} className="space-y-4">
          
          {/* Section 1: Copies & Pages */}
          <AccordionItem value="item-1" className="bg-white/40 backdrop-blur-2xl border border-white/60 shadow-[0_8px_32px_0_rgba(31,38,135,0.05)] rounded-2xl px-5 relative overflow-hidden">
            <AccordionTrigger className="text-lg font-bold text-navy hover:no-underline">Copies & Pages</AccordionTrigger>
            <AccordionContent className="pt-2 pb-5">
              <div className="flex items-center justify-between mb-5">
                <span className="text-sm font-semibold text-zinc-700">Copies</span>
                <div className="flex items-center gap-4 bg-white/60 rounded-full p-1 border border-white/50 shadow-sm">
                  <button onClick={() => setCopies(c => Math.max(1, c - 1))} className="w-8 h-8 flex items-center justify-center rounded-full bg-white text-navy font-bold shadow hover:bg-zinc-50 active:scale-95 transition-all">-</button>
                  <span className="w-6 text-center font-bold text-navy">{copies}</span>
                  <button onClick={() => setCopies(c => Math.min(50, c + 1))} className="w-8 h-8 flex items-center justify-center rounded-full bg-brand-blue text-white font-bold shadow hover:bg-blue-600 active:scale-95 transition-all">+</button>
                </div>
              </div>

              <div className="flex items-center justify-between mb-5">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-zinc-700">Collate</span>
                  <span className="text-[10px] text-zinc-500">Print in grouped sets</span>
                </div>
                <Switch checked={isCollated} onCheckedChange={setIsCollated} />
              </div>

              <div className="flex flex-col space-y-3">
                <span className="text-sm font-semibold text-zinc-700">Pages</span>
                <div className="grid grid-cols-2 gap-2">
                  <button 
                    onClick={() => { setPagesToPrint('all'); setPagesInput(''); }}
                    className={`py-2 px-3 rounded-xl text-sm font-semibold border transition-all ${pagesToPrint === 'all' ? 'bg-brand-blue text-white border-brand-blue shadow-md' : 'bg-white/50 text-zinc-600 border-white/60 hover:bg-white/80'}`}
                  >
                    All Pages
                  </button>
                  <button 
                    onClick={() => setPagesToPrint(pagesInput || '1')}
                    className={`py-2 px-3 rounded-xl text-sm font-semibold border transition-all ${pagesToPrint !== 'all' ? 'bg-brand-blue text-white border-brand-blue shadow-md' : 'bg-white/50 text-zinc-600 border-white/60 hover:bg-white/80'}`}
                  >
                    Custom
                  </button>
                </div>
                {pagesToPrint !== 'all' && (
                  <input
                    type="text"
                    value={pagesInput}
                    onChange={(e) => {
                      setPagesInput(e.target.value)
                      setPagesToPrint(e.target.value)
                    }}
                    placeholder="e.g. 1-5, 8, 11-13"
                    className="w-full mt-2 rounded-xl border border-white/60 bg-white/60 px-4 py-2.5 text-sm text-navy placeholder-zinc-400 outline-none focus:ring-2 focus:ring-brand-blue/50 shadow-inner backdrop-blur-md transition-all"
                  />
                )}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Section 2: Layout */}
          <AccordionItem value="item-2" className="bg-white/40 backdrop-blur-2xl border border-white/60 shadow-[0_8px_32px_0_rgba(31,38,135,0.05)] rounded-2xl px-5 relative overflow-hidden">
            <AccordionTrigger className="text-lg font-bold text-navy hover:no-underline">Layout</AccordionTrigger>
            <AccordionContent className="pt-2 pb-5">
              <div className="flex flex-col space-y-3 mb-5">
                <span className="text-sm font-semibold text-zinc-700">Sides</span>
                <div className="grid grid-cols-2 gap-2">
                  <button 
                    onClick={() => setDuplex(false)}
                    className={`py-2 px-3 rounded-xl text-sm font-semibold border transition-all ${!duplex ? 'bg-brand-blue text-white border-brand-blue shadow-md' : 'bg-white/50 text-zinc-600 border-white/60 hover:bg-white/80'}`}
                  >
                    1-Sided
                  </button>
                  <button 
                    onClick={() => setDuplex(true)}
                    className={`py-2 px-3 rounded-xl text-sm font-semibold border transition-all ${duplex ? 'bg-brand-blue text-white border-brand-blue shadow-md' : 'bg-white/50 text-zinc-600 border-white/60 hover:bg-white/80'}`}
                  >
                    2-Sided
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col space-y-2">
                  <span className="text-sm font-semibold text-zinc-700">Pages per sheet</span>
                  <Select value={pagesPerSheet.toString()} onValueChange={(val) => setPagesPerSheet(Number(val))}>
                    <SelectTrigger className="w-full bg-white/60 border-white/60 shadow-inner rounded-xl text-navy">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1</SelectItem>
                      <SelectItem value="2">2</SelectItem>
                      <SelectItem value="4">4</SelectItem>
                      <SelectItem value="6">6</SelectItem>
                      <SelectItem value="9">9</SelectItem>
                      <SelectItem value="16">16</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col space-y-2">
                  <span className="text-sm font-semibold text-zinc-700">Page Order</span>
                  <Select value={pageOrder} onValueChange={setPageOrder}>
                    <SelectTrigger className="w-full bg-white/60 border-white/60 shadow-inner rounded-xl text-navy">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="horizontal">Horizontal</SelectItem>
                      <SelectItem value="vertical">Vertical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="flex items-center justify-between mt-5">
                <span className="text-sm font-semibold text-zinc-700">Print Border</span>
                <Switch checked={border} onCheckedChange={setBorder} />
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Section 3: Paper & Quality */}
          <AccordionItem value="item-3" className="bg-white/40 backdrop-blur-2xl border border-white/60 shadow-[0_8px_32px_0_rgba(31,38,135,0.05)] rounded-2xl px-5 relative overflow-hidden">
            <AccordionTrigger className="text-lg font-bold text-navy hover:no-underline">Paper & Quality</AccordionTrigger>
            <AccordionContent className="pt-2 pb-5">
              <div className="flex items-center justify-between mb-5">
                <span className="text-sm font-semibold text-zinc-700">Paper Size</span>
                <span className="text-sm font-bold text-navy bg-white/60 px-3 py-1 rounded-lg border border-white/50 shadow-sm">A4 (210×297mm)</span>
              </div>

              <div className="flex flex-col space-y-3 mb-5">
                <span className="text-sm font-semibold text-zinc-700">Orientation</span>
                <div className="grid grid-cols-3 gap-2">
                  {(['auto', 'portrait', 'landscape'] as const).map((o) => (
                    <button 
                      key={o}
                      onClick={() => setOrientation(o)}
                      className={`py-2 px-2 rounded-xl text-xs font-semibold border capitalize transition-all ${orientation === o ? 'bg-brand-blue text-white border-brand-blue shadow-md' : 'bg-white/50 text-zinc-600 border-white/60 hover:bg-white/80'}`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col space-y-2">
                  <span className="text-sm font-semibold text-zinc-700">Quality</span>
                  <Select value={quality} onValueChange={setQuality}>
                    <SelectTrigger className="w-full bg-white/60 border-white/60 shadow-inner rounded-xl text-navy">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col space-y-2">
                  <span className="text-sm font-semibold text-zinc-700">Fit / Scale</span>
                  <Select value={fitScale} onValueChange={setFitScale}>
                    <SelectTrigger className="w-full bg-white/60 border-white/60 shadow-inner rounded-xl text-navy">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fit">Fit to Page</SelectItem>
                      <SelectItem value="actual">Actual Size</SelectItem>
                      <SelectItem value="shrink">Shrink Oversized</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Section 4: Colour */}
          <AccordionItem value="item-4" className="bg-white/40 backdrop-blur-2xl border border-white/60 shadow-[0_8px_32px_0_rgba(31,38,135,0.05)] rounded-2xl px-5 relative overflow-hidden">
            <AccordionTrigger className="text-lg font-bold text-navy hover:no-underline">Colour Mode</AccordionTrigger>
            <AccordionContent className="pt-2 pb-5">
              <div className="grid grid-cols-2 gap-3">
                 <button 
                    onClick={() => setColorMode('bw')}
                    className={`py-4 px-3 rounded-2xl flex flex-col items-center gap-2 border-2 transition-all ${colorMode === 'bw' ? 'bg-zinc-800 text-white border-zinc-900 shadow-lg scale-[1.02]' : 'bg-white/60 text-zinc-600 border-white/60 hover:bg-white/80'}`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${colorMode === 'bw' ? 'bg-white/20' : 'bg-zinc-200'}`}>
                      <span className="text-sm font-bold text-white mix-blend-difference">B/W</span>
                    </div>
                    <span className="text-sm font-bold">Black & White</span>
                  </button>
                  <button 
                    onClick={() => setColorMode('colour')}
                    className={`py-4 px-3 rounded-2xl flex flex-col items-center gap-2 border-2 transition-all ${colorMode === 'colour' ? 'bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 text-white border-transparent shadow-lg shadow-purple-500/30 scale-[1.02]' : 'bg-white/60 text-zinc-600 border-white/60 hover:bg-white/80'}`}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${colorMode === 'colour' ? 'bg-white/20' : 'bg-pink-100/50'}`}>
                      <div className="w-4 h-4 rounded-full bg-gradient-to-tr from-blue-500 to-pink-500" />
                    </div>
                    <span className="text-sm font-bold">Colour Print</span>
                  </button>
              </div>
            </AccordionContent>
          </AccordionItem>
          
        </Accordion>
      </div>

      {/* Sticky Bottom Price Strip */}
      <div className="absolute bottom-0 left-0 w-full p-4 z-50">
        <div className="bg-white/70 backdrop-blur-2xl border border-white/60 shadow-[0_-8px_30px_0_rgba(31,38,135,0.1)] rounded-3xl p-4 flex flex-col gap-3 relative overflow-hidden">
           <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/40 to-transparent pointer-events-none rounded-t-3xl"></div>
           
           <div className="flex items-center justify-between relative z-10 px-2">
             <div className="flex flex-col">
               <span className="text-xs font-semibold text-zinc-500">
                 {price ? `${price.billable_pages} pages × ₹${price.price_per_page}` : 'Calculating...'}
               </span>
               <div className="flex items-end gap-2">
                 <span className="text-2xl font-black text-navy leading-none">
                   ₹{price ? price.total_price.toFixed(2) : '--'}
                 </span>
                 {saving && <span className="text-[10px] font-bold text-brand-blue animate-pulse mb-1">UPDATING</span>}
               </div>
             </div>
             
             <button
                onClick={() => router.push(`/payment/${sessionId}`)}
                disabled={!price || saving}
                className="bg-brand-blue text-white font-bold py-3 px-6 rounded-xl shadow-lg shadow-brand-blue/30 hover:bg-blue-600 active:scale-95 disabled:opacity-50 disabled:active:scale-100 transition-all flex items-center gap-2"
              >
                Continue
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
           </div>
        </div>
      </div>

    </div>
  )
}
