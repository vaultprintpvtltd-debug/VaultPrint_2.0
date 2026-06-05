export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      kiosks: {
        Row: {
          id: string
          name: string
          location: string
          status: 'online' | 'idle' | 'printing' | 'offline'
          printer_name: string
          os_platform: string | null
          last_heartbeat: string | null
          api_key_hash: string
          settings: Json | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['kiosks']['Row'], 'created_at'>
        Update: Partial<Database['public']['Tables']['kiosks']['Row']>
      }
      print_jobs: {
        Row: {
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
          status: 'created' | 'uploaded' | 'customized' | 'payment_pending' | 'paid' | 'queued' | 'printing' | 'completed' | 'failed' | 'expired'
          error_message: string | null
          completed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['print_jobs']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['print_jobs']['Row']>
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
