-- ─── 005_mode2_extensions.sql ────────────────────────────────────────────────
-- Kiosk Configuration Layer + Mode 2 (school offline flow) — PRD Part C.
--
-- 1. kiosks.config JSONB          — per-kiosk mode configuration (config layer)
-- 2. print_jobs POS columns       — payment_mode + POS reconciliation fields
-- 3. mode2_upload_tokens          — single-use upload tokens (session boundary)
-- 4. expire_stale_mode2_sessions  — pg_cron cleanup for abandoned Mode 2 jobs
--
-- Note: print_jobs.status is plain TEXT (no CHECK constraint) — the
-- 'payment_pending' and 'expired' values are already part of the state
-- machine, so no status-domain change is needed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. KIOSK CONFIG LAYER ───────────────────────────────────────────────────
-- Every kiosk gets a config JSONB. Default = standard-only (Mode 1 unchanged).
-- All client configuration lives here — the schema never changes for a new
-- client type (PRD invariant C2.11).
ALTER TABLE kiosks
  ADD COLUMN config JSONB NOT NULL
  DEFAULT '{"modes":[{"id":"standard","label":"Print","enabled":true}]}';

-- ─── 2. PRINT JOBS — POS PAYMENT COLUMNS ─────────────────────────────────────
ALTER TABLE print_jobs
  ADD COLUMN payment_mode        TEXT NOT NULL DEFAULT 'razorpay',
  -- 'razorpay' | 'pos'
  ADD COLUMN pos_transaction_ref TEXT,
  -- last 6 digits of the POS merchant slip (manual mode) or terminal ref
  ADD COLUMN pos_card_last4      TEXT,
  ADD COLUMN pos_client_amount   NUMERIC(10,2);
  -- client-reported amount, reconciliation only — total_price is authoritative

-- Reporting index (admin revenue split / reconciliation)
CREATE INDEX idx_jobs_payment_mode ON print_jobs(payment_mode);

-- ─── 3. MODE 2 UPLOAD TOKENS ─────────────────────────────────────────────────
-- The security boundary of Mode 2: no upload is accepted without a live token.
-- Single-use (used_at set atomically on consumption), 5-minute expiry.
CREATE TABLE mode2_upload_tokens (
  token       TEXT PRIMARY KEY,
  -- 32 crypto-random URL-safe bytes, generated server-side
  kiosk_id    UUID NOT NULL REFERENCES kiosks(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One live (unconsumed) token per kiosk — closes the two-simultaneous-iPads
-- hole. The token route deletes any unused token before inserting a new one.
CREATE UNIQUE INDEX idx_one_live_token_per_kiosk
  ON mode2_upload_tokens(kiosk_id)
  WHERE used_at IS NULL;

CREATE INDEX idx_mode2_tokens_expiry ON mode2_upload_tokens(expires_at);

-- Backend-only table: RLS enabled with NO policies → only service_role.
ALTER TABLE mode2_upload_tokens ENABLE ROW LEVEL SECURITY;

-- ─── 4. MODE 2 SESSION EXPIRY ────────────────────────────────────────────────
-- Expires POS jobs stuck in created/customized/payment_pending beyond their
-- kiosk's session_timeout_minutes (from config, default 10), deletes their
-- Storage object, and purges tokens older than 1h past expiry.
CREATE OR REPLACE FUNCTION expire_stale_mode2_sessions()
RETURNS void AS $$
DECLARE
  v_job RECORD;
BEGIN
  FOR v_job IN
    SELECT pj.id, pj.kiosk_id, pj.file_path, pj.status AS prev_status
    FROM print_jobs pj
    JOIN kiosks k ON k.id = pj.kiosk_id
    WHERE pj.payment_mode = 'pos'
      AND pj.status IN ('created', 'uploaded', 'customized', 'payment_pending')
      AND pj.created_at < now() - make_interval(mins =>
        COALESCE(
          (
            SELECT (m->>'session_timeout_minutes')::int
            FROM jsonb_array_elements(k.config->'modes') AS m
            WHERE m->>'id' = 'school_offline'
            LIMIT 1
          ),
          10
        ))
  LOOP
    UPDATE print_jobs
    SET status = 'expired', updated_at = now()
    WHERE id = v_job.id;

    -- Remove the uploaded PDF (privacy: abandoned files must not persist)
    IF v_job.file_path IS NOT NULL THEN
      DELETE FROM storage.objects
      WHERE bucket_id = 'print-files' AND name = v_job.file_path;
    END IF;

    INSERT INTO audit_log (job_id, kiosk_id, event, actor, metadata)
    VALUES (
      v_job.id,
      v_job.kiosk_id,
      'mode2_session_expired',
      'cron',
      jsonb_build_object('previous_status', v_job.prev_status)
    );
  END LOOP;

  -- Purge dead tokens (keep 1h past expiry for audit/debugging)
  DELETE FROM mode2_upload_tokens
  WHERE expires_at < now() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- Run every minute via pg_cron (installed on the project)
SELECT cron.schedule(
  'expire-mode2-sessions',
  '* * * * *',
  'SELECT expire_stale_mode2_sessions()'
);
