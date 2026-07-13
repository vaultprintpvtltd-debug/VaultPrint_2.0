-- 006_harden_function_search_path.sql
--
-- Clears the Supabase "function_search_path_mutable" security advisory by
-- pinning an explicit search_path on every public function.
--
-- This alters ONLY the function configuration attribute, not the function
-- body or logic. Behaviour is unchanged, so the claim_next_job() concurrency
-- invariant (FOR UPDATE SKIP LOCKED) is fully preserved. `public, pg_temp`
-- keeps unqualified object references in the existing bodies resolvable while
-- making the search_path non-mutable per role.

ALTER FUNCTION public.set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.claim_next_job(p_kiosk_id uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.expire_stale_jobs() SET search_path = public, pg_temp;
ALTER FUNCTION public.recover_stuck_jobs(p_kiosk_id uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.expire_stale_mode2_sessions() SET search_path = public, pg_temp;
