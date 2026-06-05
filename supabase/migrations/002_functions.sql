-- ─── CLAIM NEXT JOB ───────────────────────────────────────────────────────────
-- Called by the print agent via GET /api/kiosk/[id]/queue
-- FOR UPDATE SKIP LOCKED ensures two agents can never claim the same job
-- even if they poll at the exact same millisecond

CREATE OR REPLACE FUNCTION claim_next_job(p_kiosk_id UUID)
RETURNS SETOF print_jobs AS $$
DECLARE
  v_job print_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job
  FROM print_jobs
  WHERE kiosk_id = p_kiosk_id
    AND status = 'queued'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE print_jobs
  SET
    status     = 'printing',
    updated_at = now()
  WHERE id = v_job.id;

  v_job.status := 'printing';
  RETURN NEXT v_job;
END;
$$ LANGUAGE plpgsql;

-- ─── EXPIRE STALE JOBS ────────────────────────────────────────────────────────
-- Scheduled by pg_cron every 5 minutes
-- Handles two cases:
--   1. User started a session but never paid (stuck in payment_pending > 2h)
--   2. User paid and got OTP but never came to the kiosk (otp_expires_at passed)

CREATE OR REPLACE FUNCTION expire_stale_jobs()
RETURNS void AS $$
BEGIN
  -- Jobs stuck waiting for payment for more than 2 hours
  UPDATE print_jobs
  SET
    status     = 'expired',
    updated_at = now()
  WHERE status IN ('created', 'uploaded', 'customized', 'payment_pending')
    AND created_at < now() - INTERVAL '2 hours';

  -- Jobs that were queued but OTP expired before user entered it
  UPDATE print_jobs
  SET
    status     = 'expired',
    updated_at = now()
  WHERE status = 'queued'
    AND otp_expires_at < now();

  -- Log the expiry events
  INSERT INTO audit_log (job_id, kiosk_id, event, actor, metadata)
  SELECT
    id,
    kiosk_id,
    'job_expired',
    'cron',
    jsonb_build_object('reason', 'stale_job_cleanup', 'previous_status', status)
  FROM print_jobs
  WHERE status = 'expired'
    AND updated_at > now() - INTERVAL '6 minutes';
END;
$$ LANGUAGE plpgsql;

-- ─── RECOVER STUCK PRINTING JOBS ─────────────────────────────────────────────
-- Called by the print agent on startup to reset any job it
-- left in 'printing' state before a crash

CREATE OR REPLACE FUNCTION recover_stuck_jobs(p_kiosk_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE print_jobs
  SET
    status     = 'queued',
    updated_at = now()
  WHERE kiosk_id    = p_kiosk_id
    AND status      = 'printing'
    AND updated_at  < now() - INTERVAL '10 minutes';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    INSERT INTO audit_log (kiosk_id, event, actor, metadata)
    VALUES (
      p_kiosk_id,
      'job_recovered',
      'kiosk_agent',
      jsonb_build_object('recovered_count', v_count)
    );
  END IF;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;