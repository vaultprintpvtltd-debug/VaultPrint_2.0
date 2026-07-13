import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// PATCH /api/jobs/[id]/settings
//
// Saves print configuration for a job. Looks up pricing_config to calculate
// billable_pages and total_price. Updates print_jobs row.
//
// Request body: { copies, color_mode, duplex, orientation, pages_to_print, paper_size }
// Response:     { price_per_page, billable_pages, total_price, settings }
// ---------------------------------------------------------------------------

function getAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

// Parse a pages_to_print string like 'all', '1-5', '1,3,5-7' into a count
function countPages(pagesToPrint: string, totalPages: number): number {
  if (!pagesToPrint || pagesToPrint === 'all') return totalPages

  const pages = new Set<number>()
  const parts = pagesToPrint.split(',').map((p) => p.trim())

  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-')
      const start = Math.max(1, parseInt(startStr, 10))
      const end = Math.min(totalPages, parseInt(endStr, 10))
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) pages.add(i)
      }
    } else {
      const num = parseInt(part, 10)
      if (!isNaN(num) && num >= 1 && num <= totalPages) pages.add(num)
    }
  }

  return pages.size || totalPages
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const supabase = getAdminSupabase()

  // 1. Fetch the job
  const { data: job, error: jobError } = await supabase
    .from('print_jobs')
    .select('id, kiosk_id, total_pages, status')
    .eq('session_id', sessionId)
    .single()

  if (jobError || !job) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  if (!['uploaded', 'customized'].includes(job.status)) {
    return NextResponse.json(
      { error: `Cannot update settings in "${job.status}" status` },
      { status: 409 }
    )
  }

  if (!job.total_pages || job.total_pages < 1) {
    return NextResponse.json(
      { error: 'File not yet processed. Upload and confirm first.' },
      { status: 400 }
    )
  }

  // 2. Validate and extract settings
  const copies = Math.max(1, Math.min(50, parseInt(String(body.copies), 10) || 1))
  const color_mode = ['bw', 'colour'].includes(String(body.color_mode)) ? (body.color_mode as string) : 'bw'
  const duplex = body.duplex === true
  const orientation = ['portrait', 'landscape', 'auto'].includes(String(body.orientation)) ? (body.orientation as string) : 'auto'
  const pages_to_print = typeof body.pages_to_print === 'string' ? body.pages_to_print.trim() : 'all'
  const paper_size = 'A4' // Always A4 for v1

  // Advanced settings
  const is_collated = typeof body.is_collated === 'boolean' ? body.is_collated : true
  const pagesPerSheetParsed = parseInt(String(body.pages_per_sheet), 10)
  const pages_per_sheet = [1, 2, 4, 6, 9, 16].includes(pagesPerSheetParsed) ? pagesPerSheetParsed : 1
  const page_order = ['horizontal', 'horizontal-reverse', 'vertical', 'vertical-reverse'].includes(String(body.page_order)) ? (body.page_order as string) : 'horizontal'
  const border = body.border === true
  const quality = ['draft', 'standard', 'high'].includes(String(body.quality)) ? (body.quality as string) : 'standard'
  const fit_scale = ['fit', 'actual', 'shrink'].includes(String(body.fit_scale)) ? (body.fit_scale as string) : 'fit'

  // 3. Look up pricing
  const { data: pricing, error: pricingError } = await supabase
    .from('pricing_config')
    .select('price_per_page')
    .eq('color_mode', color_mode)
    .eq('paper_size', paper_size)
    .eq('duplex', duplex)
    .eq('is_active', true)
    .single()

  if (pricingError || !pricing) {
    return NextResponse.json(
      { error: 'Pricing configuration not found for selected options' },
      { status: 400 }
    )
  }

  // 4. Calculate price
  const pagesToPrintCount = countPages(pages_to_print, job.total_pages)
  const billable_pages = pagesToPrintCount * copies
  const price_per_page = parseFloat(pricing.price_per_page)
  const total_price = parseFloat((billable_pages * price_per_page).toFixed(2))

  // 5. Update job
  const { error: updateError } = await supabase
    .from('print_jobs')
    .update({
      copies,
      color_mode,
      duplex,
      orientation,
      pages_to_print,
      paper_size,
      is_collated,
      pages_per_sheet,
      page_order,
      border,
      quality,
      fit_scale,
      billable_pages,
      price_per_page,
      total_price,
      status: 'customized',
    })
    .eq('id', job.id)

  if (updateError) {
    console.error('Failed to update settings:', updateError)
    return NextResponse.json(
      { error: 'Failed to save settings', details: updateError.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    price_per_page,
    billable_pages,
    total_price,
    settings: { 
      copies, color_mode, duplex, orientation, pages_to_print, paper_size,
      is_collated, pages_per_sheet, page_order, border, quality, fit_scale
    },
  })
}
