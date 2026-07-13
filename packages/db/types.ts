export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// NOTE: these are `type` aliases, not `interface`s, on purpose. supabase-js /
// postgrest-js constrain each table's Row to `Record<string, unknown>`, which
// a TypeScript `interface` does NOT satisfy (interfaces have no implicit index
// signature). Declaring them as `type` object literals makes the Database type
// satisfy `GenericSchema`, so query results are typed correctly instead of
// collapsing to `never`.

export type KioskRow = {
  id: string
  name: string
  location: string | null
  status: 'online' | 'idle' | 'printing' | 'offline'
  printer_name: string
  os_platform: string | null
  last_heartbeat: string | null
  api_key_hash: string
  settings: Json | null
  config: Json
  created_at: string
}

export type PrintJobRow = {
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
  payment_mode: 'razorpay' | 'pos'
  pos_transaction_ref: string | null
  pos_card_last4: string | null
  pos_client_amount: number | null
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

export type PricingConfigRow = {
  id: string
  color_mode: 'bw' | 'colour'
  paper_size: string
  duplex: boolean
  price_per_page: number
  is_active: boolean
  updated_at: string
}

export type AuditLogRow = {
  id: string
  job_id: string | null
  kiosk_id: string | null
  event: string
  actor: string
  metadata: Json
  created_at: string
}

export type Mode2UploadTokenRow = {
  token: string
  kiosk_id: string
  expires_at: string
  used_at: string | null
  created_at: string
}

export type Database = {
  public: {
    Tables: {
      kiosks: {
        Row: KioskRow
        Insert: Partial<KioskRow>
        Update: Partial<KioskRow>
        Relationships: []
      }
      print_jobs: {
        Row: PrintJobRow
        Insert: Partial<PrintJobRow>
        Update: Partial<PrintJobRow>
        Relationships: []
      }
      pricing_config: {
        Row: PricingConfigRow
        Insert: Partial<PricingConfigRow>
        Update: Partial<PricingConfigRow>
        Relationships: []
      }
      audit_log: {
        Row: AuditLogRow
        Insert: Partial<AuditLogRow>
        Update: Partial<AuditLogRow>
        Relationships: []
      }
      mode2_upload_tokens: {
        Row: Mode2UploadTokenRow
        Insert: Partial<Mode2UploadTokenRow>
        Update: Partial<Mode2UploadTokenRow>
        Relationships: []
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
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
