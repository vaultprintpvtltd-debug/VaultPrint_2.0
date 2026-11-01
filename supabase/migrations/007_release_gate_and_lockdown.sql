-- ─── 007_release_gate_and_lockdown.sql ───────────────────────────────────────
-- 1. OTP release gate (state machine). Payment now leaves a Mode 1 job in
--    'paid'; only a correct OTP entered at the kiosk moves it 'paid' → 'queued'.
--    The print agent claims 'queued' jobs via claim_next_job (unchanged).
--    Previously payment went straight to 'queued', so the agent printed the
--    document before the customer ever reached the kiosk.
--
-- 2. Anon-key lockdown. The anon key ships in every browser bundle:
--    - it could INSERT print_jobs with any status → free prints
--    - it could SELECT every column (otp_hash, file_name, file_path,
--      razorpay ids) of every job, and kiosks.api_key_hash
--    Job creation now goes through service-role server code only, and anon
--    keeps column-level SELECT on just what the kiosk screens render
--    (Realtime honours column privileges, so payloads are trimmed too).
--
-- 3. expire_stale_jobs: also expires 'paid' jobs whose OTP lapsed and
--    'queued' jobs never claimed by an agent; one audit row per expiry
--    (the old 6-minute window re-logged jobs). It was never scheduled on the
--    live project — scheduled here every 5 minutes.
--
-- Mode 1 only. Mode 2 (POS) objects are intentionally left untouched.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 2. ANON LOCKDOWN ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Anyone can create a print job" ON print_jobs;
DROP POLICY IF EXISTS "Anyone can insert audit events" ON audit_log;
-- Uploads use createSignedUploadUrl tokens, which do not need an anon policy
DROP POLICY IF EXISTS "Anyone can upload print files" ON storage.objects;

REVOKE ALL ON print_jobs FROM anon;
GRANT SELECT (
  id, kiosk_id, status, payment_mode,
  total_pages, copies, color_mode, duplex, total_price,
  otp_expires_at, completed_at, created_at, updated_at
) ON print_jobs TO anon;

REVOKE ALL ON kiosks FROM anon;
GRANT SELECT (id, name, location, status, config, last_heartbeat, created_at)
  ON kiosks TO anon;

REVOKE ALL ON audit_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON pricing_config FROM anon;

-- ─── 3. EXPIRE STALE JOBS ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION expire_stale_jobs()
RETURNS void
SET search_path = public, pg_temp
AS $$
BEGIN
  WITH stale AS (
    SELECT id, status AS prev_status
    FROM print_jobs
    WHERE
      -- never paid
      (status IN ('created', 'uploaded', 'customized', 'payment_pending')
        AND created_at < now() - INTERVAL '2 hours')
      -- paid, but the customer never entered the OTP at the kiosk
      OR (status = 'paid' AND otp_expires_at < now())
      -- released at the kiosk, but no agent claimed it (printer offline)
      OR (status = 'queued' AND updated_at < now() - INTERVAL '30 minutes')
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
      -- the customer paid but never got a print → needs a refund
      'refund_due', prev_status IN ('paid', 'queued')
    )
  FROM expired;
END;
$$ LANGUAGE plpgsql;

SELECT cron.schedule(
  'expire-stale-jobs',
  '*/5 * * * *',
  'SELECT expire_stale_jobs()'
);
