-- ─── KIOSKS ───────────────────────────────────────────────────────────────────
CREATE TABLE kiosks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  location         TEXT,
  status           TEXT NOT NULL DEFAULT 'offline',
  printer_name     TEXT NOT NULL,
  os_platform      TEXT,
  last_heartbeat   TIMESTAMPTZ,
  api_key_hash     TEXT NOT NULL,
  settings         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── PRINT JOBS ───────────────────────────────────────────────────────────────
CREATE TABLE print_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  kiosk_id            UUID NOT NULL REFERENCES kiosks(id),

  -- file
  file_path           TEXT,
  file_name           TEXT,
  total_pages         INTEGER,

  -- pages to print
  pages_to_print      TEXT NOT NULL DEFAULT 'all',
  -- 'all' | '1-5' | '1,3,5-7'

  -- copies
  copies              INTEGER NOT NULL DEFAULT 1,
  collate             BOOLEAN NOT NULL DEFAULT true,

  -- colour
  color_mode          TEXT NOT NULL DEFAULT 'bw',
  -- 'bw' | 'colour'
  color_profile       TEXT NOT NULL DEFAULT 'grayscale',
  -- 'grayscale' | 'srgb' | 'cmyk_simulation'

  -- paper — always A4, stored for audit trail
  paper_size          TEXT NOT NULL DEFAULT 'A4',

  -- layout
  orientation         TEXT NOT NULL DEFAULT 'auto',
  -- 'portrait' | 'landscape' | 'auto'
  duplex              BOOLEAN NOT NULL DEFAULT false,
  duplex_type         TEXT NOT NULL DEFAULT 'long_edge',
  -- 'long_edge' | 'short_edge'
  pages_per_sheet     INTEGER NOT NULL DEFAULT 1,
  -- 1 | 2 | 4
  page_order          TEXT NOT NULL DEFAULT 'front_to_back',
  -- 'front_to_back' | 'back_to_front'
  page_border         TEXT NOT NULL DEFAULT 'none',
  -- 'none' | 'single_line' | 'box'

  -- quality & scaling
  print_quality       TEXT NOT NULL DEFAULT 'normal',
  -- 'draft' | 'normal' | 'high'
  fit_to_page         BOOLEAN NOT NULL DEFAULT true,
  page_scaling        TEXT NOT NULL DEFAULT 'fit',
  -- 'fit' | 'shrink' | 'actual' | 'custom'
  custom_scale        INTEGER NOT NULL DEFAULT 100,
  -- percentage 1–200, only used when page_scaling = 'custom'

  -- pricing (snapshot at time of order — never changes after)
  billable_pages      INTEGER,
  price_per_page      NUMERIC(10,2),
  total_price         NUMERIC(10,2),

  -- payment
  razorpay_order_id   TEXT UNIQUE,
  razorpay_payment_id TEXT,
  razorpay_signature  TEXT,

  -- otp
  otp_hash            TEXT,
  otp_expires_at      TIMESTAMPTZ,
  otp_attempts        INTEGER NOT NULL DEFAULT 0,

  -- status state machine:
  -- created → uploaded → customized → payment_pending
  -- → paid → queued → printing → completed
  --                             → failed
  --                             → expired
  --                             → refunded
  status              TEXT NOT NULL DEFAULT 'created',

  error_message       TEXT,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── PRICING CONFIG ───────────────────────────────────────────────────────────
CREATE TABLE pricing_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  color_mode      TEXT NOT NULL,
  -- 'bw' | 'colour'
  paper_size      TEXT NOT NULL DEFAULT 'A4',
  -- always 'A4' for v1
  duplex          BOOLEAN NOT NULL,
  price_per_page  NUMERIC(10,2) NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(color_mode, paper_size, duplex)
);

-- ─── AUDIT LOG ────────────────────────────────────────────────────────────────
CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID REFERENCES print_jobs(id),
  kiosk_id    UUID REFERENCES kiosks(id),
  event       TEXT NOT NULL,
  -- 'session_created' | 'file_uploaded' | 'settings_saved'
  -- | 'payment_initiated' | 'payment_verified' | 'otp_generated'
  -- | 'otp_attempt_wrong' | 'otp_verified' | 'job_claimed'
  -- | 'print_started' | 'print_completed' | 'print_failed'
  -- | 'job_expired' | 'refund_issued' | 'api_key_regenerated'
  actor       TEXT NOT NULL DEFAULT 'system',
  -- 'user' | 'kiosk_agent' | 'webhook' | 'admin' | 'cron' | 'system'
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── INDEXES ──────────────────────────────────────────────────────────────────
CREATE INDEX idx_jobs_kiosk_status  ON print_jobs(kiosk_id, status);
CREATE INDEX idx_jobs_session       ON print_jobs(session_id);
CREATE INDEX idx_jobs_status        ON print_jobs(status);
CREATE INDEX idx_jobs_created_at    ON print_jobs(created_at DESC);
CREATE INDEX idx_audit_job          ON audit_log(job_id);
CREATE INDEX idx_audit_kiosk        ON audit_log(kiosk_id);
CREATE INDEX idx_audit_created_at   ON audit_log(created_at DESC);

-- ─── UPDATED_AT TRIGGER ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_print_jobs_updated_at
  BEFORE UPDATE ON print_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_pricing_config_updated_at
  BEFORE UPDATE ON pricing_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();