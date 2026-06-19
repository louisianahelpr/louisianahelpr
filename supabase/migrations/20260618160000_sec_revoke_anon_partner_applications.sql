-- F-SEC-05: close the direct anon write path to partner_applications.
--
-- The /become-a-partner page used to insert directly as anon, backed by a
-- permissive RLS policy (WITH CHECK true) plus a broad anon table grant. An
-- INSERT policy cannot rate-limit or validate, so anyone could script unlimited
-- rows. Writes now go exclusively through the submit-partner-application edge
-- function (IP-rate-limited + server-validated, inserting via service_role).
--
-- Here we drop the permissive policy and revoke every anon table privilege so
-- the edge function is the only anon-reachable way in. service_role keeps full
-- access via admin_all_partner_applications + its grants.
--
-- Replay-safe: guarded on table existence; DROP POLICY IF EXISTS and REVOKE are
-- both idempotent.

DO $$
BEGIN
  IF to_regclass('public.partner_applications') IS NOT NULL THEN
    DROP POLICY IF EXISTS public_insert_partner_applications ON public.partner_applications;
    REVOKE ALL ON TABLE public.partner_applications FROM anon;
  END IF;
END;
$$;
