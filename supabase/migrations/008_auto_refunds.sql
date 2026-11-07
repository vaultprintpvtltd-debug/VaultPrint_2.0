-- ===========================================================================
-- 008 — Automatic refunds (Mode 1 / Razorpay)
--
-- A customer who paid but never got their print is refunded automatically:
--   * paid, but the code was never entered at the kiosk  → job expires → refund
--   * released at the kiosk, but no printer took it        → job expires → refund
--   * the print failed (paper out, jam, printer off …)    → job failed  → refund
--
-- The refund itself is made by the mobile app (it holds the Razorpay keys):
-- POST https://mobile.vaultprint.in/api/cron/refunds. pg_cron calls it every
-- minute, but only while a refund is actually due (no idle invocations).
-- The call is authenticated with a random secret kept in internal_config
-- (RLS on, no policies → readable only with the service key).
--
-- Jobs that existed before this migration are marked 'not_auto' and are
-- never refunded automatically.
-- ===========================================================================

-- ── Refund tracking on the job ────────────────────────────────────────────
ALTER TABLE print_jobs
  ADD COLUMN IF NOT EXISTS refund_status   TEXT,          -- NULL | pending | processed | failed | not_auto | not_applicable
  ADD COLUMN IF NOT EXISTS refund_id       TEXT,          -- Razorpay rfnd_…
  ADD COLUMN IF NOT EXISTS refund_amount   NUMERIC(10,2), -- rupees
  ADD COLUMN IF NOT EXISTS refund_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_error    TEXT,
  ADD COLUMN IF NOT EXISTS refunded_at     TIMESTAMPTZ;

-- History: jobs already finished (or abandoned over a day ago) stay manual
UPDATE print_jobs SET refund_status = 'not_auto'
WHERE refund_status IS NULL
  AND (status IN ('expired', 'failed', 'completed') OR created_at < now() - INTERVAL '1 day');

CREATE INDEX IF NOT EXISTS print_jobs_refund_due_idx
  ON print_jobs (updated_at)
  WHERE status IN ('expired', 'failed') AND refund_status IS NULL;

-- ── Printer state the kiosk screen can show (set by every heartbeat) ─────
-- ready | printing | paper_out | not_connected | error
ALTER TABLE kiosks ADD COLUMN IF NOT EXISTS printer_state TEXT;
GRANT SELECT (printer_state) ON kiosks TO anon;

-- ── Private config (service key only) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS internal_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE internal_config ENABLE ROW LEVEL SECURITY;  -- no policies: anon/authenticated see nothing

INSERT INTO internal_config (key, value)
VALUES ('refund_cron_secret', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (key) DO NOTHING;

INSERT INTO internal_config (key, value)
VALUES ('refund_endpoint', 'https://mobile.vaultprint.in/api/cron/refunds')
ON CONFLICT (key) DO NOTHING;

-- ── Expiry: also catch paid jobs with no code expiry, release faster ─────
CREATE OR REPLACE FUNCTION public.expire_stale_jobs()
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  WITH stale AS (
    SELECT id, status AS prev_status
    FROM print_jobs
    WHERE
      -- never paid
      (status IN ('created', 'uploaded', 'customized', 'payment_pending')
        AND created_at < now() - INTERVAL '2 hours')
      -- paid, but the customer never entered the code at the kiosk
      -- (no recorded expiry → 30 minutes after the payment was recorded)
      OR (status = 'paid'
        AND COALESCE(otp_expires_at, updated_at + INTERVAL '30 minutes') < now())
      -- released at the kiosk, but no agent claimed it (printer offline)
      OR (status = 'queued' AND updated_at < now() - INTERVAL '10 minutes')
    FOR UPDATE SKIP LOCKED
  ),
  expired AS (
    UPDATE print_jobs pj
    SET status = 'expired'
    FROM stale
    WHERE pj.id = stale.id
    RETURNING pj.id, pj.kiosk_id, stale.prev_status
  )
  INSERT INTO audit_log (job_id, kiosk_id, event, actor, metadata)
  SELECT
    id,
    kiosk_id,
    'job_expired',
    'cron',
    jsonb_build_object(
      'reason', 'stale_job_cleanup',
      'previous_status', prev_status,
      'refund_due', prev_status IN ('paid', 'queued')
    )
  FROM expired;
END;
$function$;

-- ── Refund trigger: every minute, only when something is due ─────────────
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.trigger_due_refunds()
RETURNS void
LANGUAGE plpgsql
-- Not SECURITY DEFINER: run by pg_cron as postgres; anyone else calling it
-- can't read internal_config (RLS) and so can't trigger anything
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_secret   TEXT;
  v_endpoint TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM print_jobs
    WHERE status IN ('expired', 'failed')
      AND payment_mode = 'razorpay'
      AND razorpay_payment_id LIKE 'pay\_%'
      AND (refund_status IS NULL OR (refund_status = 'failed' AND refund_attempts < 5))
  ) THEN
    RETURN;
  END IF;

  SELECT value INTO v_secret   FROM internal_config WHERE key = 'refund_cron_secret';
  SELECT value INTO v_endpoint FROM internal_config WHERE key = 'refund_endpoint';

  PERFORM net.http_post(
    url := v_endpoint,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
END;
$function$;

SELECT cron.schedule('process-refunds', '* * * * *', 'SELECT public.trigger_due_refunds()');
