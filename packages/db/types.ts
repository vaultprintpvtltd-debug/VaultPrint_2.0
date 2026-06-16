export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface KioskRow {
  id: string
  name: string
  location: string | null
  status: 'online' | 'idle' | 'printing' | 'offline'
  printer_name: string
  os_platform: string | null
  last_heartbeat: string | null
  api_key_hash: string
  settings: Json | null
  created_at: string
}

export interface PrintJobRow {
  id: string
  session_id: string
  kiosk_id: string
  file_path: string | null
  file_name: string | null
  total_pages: number | null
  pages_to_print: string | null
  copies: number
  color_mode: 'bw' | 'colour'
  paper_size: string | null
  orientation: 'portrait' | 'landscape' | 'auto'
  duplex: boolean
  billable_pages: number | null
  price_per_page: number | null
  total_price: number | null
  razorpay_order_id: string | null
  razorpay_payment_id: string | null
  otp_hash: string | null
  otp_expires_at: string | null
  otp_attempts: number
  is_collated: boolean
  pages_per_sheet: number
  page_order: string
  border: boolean
  quality: string
  fit_scale: string
  status: 'created' | 'uploaded' | 'customized' | 'payment_pending' | 'paid' | 'queued' | 'printing' | 'completed' | 'failed' | 'expired'
  error_message: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface Database {
  public: {
    Tables: {
      kiosks: {
        Row: KioskRow
        Insert: Partial<KioskRow>
        Update: Partial<KioskRow>
      }
      print_jobs: {
        Row: PrintJobRow
        Insert: Partial<PrintJobRow>
        Update: Partial<PrintJobRow>
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}
