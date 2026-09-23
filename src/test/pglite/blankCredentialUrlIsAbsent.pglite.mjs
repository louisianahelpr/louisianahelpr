#!/usr/bin/env node
/**
 * PGlite proof for 20260923104534_blank_credential_url_is_absent (docs/OPEN.md Q120).
 *
 *   node src/test/pglite/blankCredentialUrlIsAbsent.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/blankCredentialUrlIsAbsent.pglite.mjs   # RED: live trigger
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the LIVE prod trigger chain on public.profiles (pg_trigger +
 * pg_get_functiondef, 2026-09-23): tr_prevent_self_escalation runs first
 * (BEFORE UPDATE triggers fire in name order) and resets every status column
 * for a member, then trg_auto_pending_credentials (with its live WHEN clause)
 * decides the credential state from the URL. Both function bodies verbatim;
 * the "before" auto_pending_credentials is the live one. The new migration is
 * applied 3x (replay-safe), then:
 *   - a member writing ' ' or a tab/newline URL gets status 'none', the flag
 *     false and the URL stored as NULL (RED on the live trigger: 'pending');
 *   - withdrawing a real document by writing spaces clears it like NULL does;
 *   - a member writing ' ' over a credential verified from helper_credentials
 *     (profile URL NULL, status 'verified': review_credential's shape) leaves
 *     the badge alone, exactly as a NULL write does;
 *   - an admin writing ' ' does not set is_licensed;
 *   - a real path still gives 'pending' + true and is stored as written;
 *   - the business-rename re-review is unchanged;
 *   - the function keeps SECURITY DEFINER, search_path=public and no
 *     PUBLIC/anon/authenticated EXECUTE.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(
  new URL("../../../supabase/migrations/20260923104534_blank_credential_url_is_absent.sql", import.meta.url).pathname,
  "utf8",
);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) trigger (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ADMIN = "aaaaaaaa-0000-0000-0000-00000000000a";
const M = (n) => `11111111-0000-0000-0000-00000000000${n}`;

// Every column the live prevent_self_escalation() touches. Types are
// irrelevant to it (it only copies OLD -> NEW), so the ones this proof does
// not read are text.
const PSE_TEXT_COLS = `
  subscription_tier, subscription_expires_at, stripe_customer_id, stripe_subscription_id,
  subscription_billing_cycle, subscription_cancel_at_period_end, apple_original_transaction_id,
  ban_status, stripe_account_id, denial_reason, denial_email_count,
  last_denial_email_at, approval_email_count, last_approval_email_at, drip_step, last_drip_at,
  idv_status, idv_session_id, idv_attempted_at, idv_attempt_count, idv_confidence,
  idv_failure_reason, legacy_manual_review, id_verification_status, has_applied_before,
  background_check_status, is_legacy_user, onboarding_fee_paid, onboarding_fee_charged_at,
  email_verified, verification_email_count, last_verification_email_at, application_count,
  auto_suspended_until, license_reviewed_by, insurance_reviewed_by, license_expires_at,
  insurance_expires_at, stripe_identity_verified, stripe_identity_verified_at,
  stripe_charges_enabled, stripe_payouts_enabled, is_seed`
  .split(",")
  .map((c) => c.trim())
  .filter(Boolean);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin','customer','helper');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE OR REPLACE FUNCTION public.has_role(_uid uuid, _role public.app_role) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = _role) $$;
-- Live is_server_context (pg_get_functiondef 2026-09-23), minus auth.role() which this fixture lacks.
CREATE OR REPLACE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS
  $$ SELECT auth.uid() IS NULL
       AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated') $$;
CREATE TABLE public.error_logs (severity text, message text, tags jsonb, context jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY, business_name text,
  license_url text, insurance_url text,
  license_status text DEFAULT 'none', insurance_status text DEFAULT 'none',
  is_licensed boolean DEFAULT false, is_insured boolean DEFAULT false,
  license_reviewed_at timestamptz, insurance_reviewed_at timestamptz,
  license_rejection_reason text, insurance_rejection_reason text,
  ${PSE_TEXT_COLS.map((c) => `${c} text`).join(", ")}
);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');

-- Live prevent_self_escalation, verbatim (pg_get_functiondef 2026-09-23).
CREATE OR REPLACE FUNCTION public.prevent_self_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_billing_attempt boolean;
  v_attempted_tier text;
BEGIN
  IF public.is_server_context() OR has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  IF current_setting('app.trusted_ladder_write', true) = 'on' THEN
    RETURN NEW;
  END IF;

  v_billing_attempt :=
       NEW.subscription_tier                 IS DISTINCT FROM OLD.subscription_tier
    OR NEW.subscription_expires_at           IS DISTINCT FROM OLD.subscription_expires_at
    OR NEW.stripe_customer_id                IS DISTINCT FROM OLD.stripe_customer_id
    OR NEW.stripe_subscription_id            IS DISTINCT FROM OLD.stripe_subscription_id
    OR NEW.subscription_billing_cycle        IS DISTINCT FROM OLD.subscription_billing_cycle
    OR NEW.subscription_cancel_at_period_end IS DISTINCT FROM OLD.subscription_cancel_at_period_end
    OR NEW.apple_original_transaction_id     IS DISTINCT FROM OLD.apple_original_transaction_id;
  v_attempted_tier := NEW.subscription_tier;

  NEW.ban_status := OLD.ban_status;
  NEW.stripe_account_id := OLD.stripe_account_id;
  NEW.subscription_tier := OLD.subscription_tier;
  NEW.subscription_expires_at := OLD.subscription_expires_at;
  NEW.denial_reason := OLD.denial_reason;
  NEW.denial_email_count := OLD.denial_email_count;
  NEW.last_denial_email_at := OLD.last_denial_email_at;
  NEW.approval_email_count := OLD.approval_email_count;
  NEW.last_approval_email_at := OLD.last_approval_email_at;
  NEW.drip_step := OLD.drip_step;
  NEW.last_drip_at := OLD.last_drip_at;

  NEW.idv_status := OLD.idv_status;
  NEW.idv_session_id := OLD.idv_session_id;
  NEW.idv_attempted_at := OLD.idv_attempted_at;
  NEW.idv_attempt_count := OLD.idv_attempt_count;
  NEW.idv_confidence := OLD.idv_confidence;
  NEW.idv_failure_reason := OLD.idv_failure_reason;
  NEW.legacy_manual_review := OLD.legacy_manual_review;

  NEW.id_verification_status := OLD.id_verification_status;
  NEW.has_applied_before := OLD.has_applied_before;

  NEW.background_check_status := OLD.background_check_status;
  NEW.is_legacy_user := OLD.is_legacy_user;

  NEW.onboarding_fee_paid := OLD.onboarding_fee_paid;
  NEW.onboarding_fee_charged_at := OLD.onboarding_fee_charged_at;
  NEW.email_verified := OLD.email_verified;
  NEW.verification_email_count := OLD.verification_email_count;
  NEW.last_verification_email_at := OLD.last_verification_email_at;

  NEW.application_count := OLD.application_count;
  NEW.auto_suspended_until := OLD.auto_suspended_until;

  NEW.license_status := OLD.license_status;
  NEW.insurance_status := OLD.insurance_status;
  NEW.license_reviewed_at := OLD.license_reviewed_at;
  NEW.insurance_reviewed_at := OLD.insurance_reviewed_at;
  NEW.license_reviewed_by := OLD.license_reviewed_by;
  NEW.insurance_reviewed_by := OLD.insurance_reviewed_by;
  NEW.license_rejection_reason := OLD.license_rejection_reason;
  NEW.insurance_rejection_reason := OLD.insurance_rejection_reason;

  NEW.license_expires_at := OLD.license_expires_at;
  NEW.insurance_expires_at := OLD.insurance_expires_at;

  NEW.is_licensed := OLD.is_licensed;
  NEW.is_insured := OLD.is_insured;

  NEW.stripe_identity_verified := OLD.stripe_identity_verified;
  NEW.stripe_identity_verified_at := OLD.stripe_identity_verified_at;
  NEW.stripe_charges_enabled := OLD.stripe_charges_enabled;
  NEW.stripe_payouts_enabled := OLD.stripe_payouts_enabled;
  NEW.is_seed := OLD.is_seed;

  NEW.stripe_customer_id := OLD.stripe_customer_id;
  NEW.stripe_subscription_id := OLD.stripe_subscription_id;
  NEW.subscription_billing_cycle := OLD.subscription_billing_cycle;
  NEW.subscription_cancel_at_period_end := OLD.subscription_cancel_at_period_end;

  NEW.apple_original_transaction_id := OLD.apple_original_transaction_id;

  IF v_billing_attempt THEN
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.error_logs e
         WHERE e.tags->>'source' = 'rls-escalation-refused'
           AND e.tags->>'user_id' = auth.uid()::text
           AND e.created_at > now() - interval '1 hour'
      ) THEN
        INSERT INTO public.error_logs (severity, message, tags, context)
        VALUES (
          'warning',
          'Refused a non-admin write to the profiles billing columns',
          jsonb_build_object('source', 'rls-escalation-refused',
                             'area', 'security',
                             'user_id', auth.uid()::text),
          jsonb_build_object(
            'current_tier',   OLD.subscription_tier,
            'attempted_tier', v_attempted_tier,
            'row_user_id',    OLD.user_id::text));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

-- Live auto_pending_credentials, verbatim (pg_get_functiondef 2026-09-23): the "before".
CREATE OR REPLACE FUNCTION public.auto_pending_credentials()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_admin_writer boolean := (auth.uid() IS NOT NULL AND has_role(auth.uid(), 'admin'));
BEGIN
  IF NEW.license_url IS DISTINCT FROM OLD.license_url THEN
    IF NEW.license_url IS NOT NULL AND NEW.license_url <> '' THEN
      NEW.is_licensed := true;
      IF NOT is_admin_writer THEN
        NEW.license_status := 'pending';
        NEW.license_reviewed_at := NULL;
        NEW.license_reviewed_by := NULL;
        NEW.license_rejection_reason := NULL;
      END IF;
    ELSE
      NEW.license_status := 'none';
      NEW.is_licensed := false;
    END IF;
  END IF;
  IF NEW.insurance_url IS DISTINCT FROM OLD.insurance_url THEN
    IF NEW.insurance_url IS NOT NULL AND NEW.insurance_url <> '' THEN
      NEW.is_insured := true;
      IF NOT is_admin_writer THEN
        NEW.insurance_status := 'pending';
        NEW.insurance_reviewed_at := NULL;
        NEW.insurance_reviewed_by := NULL;
        NEW.insurance_rejection_reason := NULL;
      END IF;
    ELSE
      NEW.insurance_status := 'none';
      NEW.is_insured := false;
    END IF;
  END IF;
  IF NEW.business_name IS DISTINCT FROM OLD.business_name AND NOT is_admin_writer THEN
    IF OLD.license_status = 'verified' AND NEW.license_status = 'verified' THEN
      NEW.license_status := 'pending';
      NEW.license_reviewed_at := NULL;
      NEW.license_reviewed_by := NULL;
      NEW.license_rejection_reason := NULL;
    END IF;
    IF OLD.insurance_status = 'verified' AND NEW.insurance_status = 'verified' THEN
      NEW.insurance_status := 'pending';
      NEW.insurance_reviewed_at := NULL;
      NEW.insurance_reviewed_by := NULL;
      NEW.insurance_rejection_reason := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.auto_pending_credentials() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_self_escalation() FROM PUBLIC, anon, authenticated;

-- Live triggers (pg_get_triggerdef 2026-09-23).
CREATE TRIGGER tr_prevent_self_escalation BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION prevent_self_escalation();
CREATE TRIGGER trg_auto_pending_credentials BEFORE UPDATE ON public.profiles
  FOR EACH ROW WHEN (((old.license_url IS DISTINCT FROM new.license_url) OR (old.insurance_url IS DISTINCT FROM new.insurance_url) OR (old.business_name IS DISTINCT FROM new.business_name)))
  EXECUTE FUNCTION auto_pending_credentials();
`);

if (MODE !== "skip") {
  for (let i = 1; i <= 3; i++) {
    try {
      await db.exec(NEW);
      check(`migration applies (pass ${i}/3)`, true);
    } catch (e) {
      check(`migration applies (pass ${i}/3)`, false, e.message);
    }
  }
}

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const seed = async (uid, cols = {}) => {
  const keys = ["user_id", ...Object.keys(cols)];
  const vals = [uid, ...Object.values(cols)];
  await q(`INSERT INTO public.profiles (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`, vals);
};
/** Run an UPDATE as a signed-in member (role authenticated) or admin. */
const asUser = async (uid, set, params) => {
  await db.exec(`SET ROLE authenticated`);
  await q(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  try {
    await q(`UPDATE public.profiles SET ${set} WHERE user_id = $1`, [uid, ...params]);
  } finally {
    await db.exec(`RESET ROLE`);
    await q(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
};
const asAdmin = async (target, set, params) => {
  await q(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [ADMIN]);
  try {
    await q(`UPDATE public.profiles SET ${set} WHERE user_id = $1`, [target, ...params]);
  } finally {
    await q(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
};
const row = async (uid) => (await q(`SELECT * FROM public.profiles WHERE user_id = $1`, [uid]))[0];
const show = (r, k) => `url=${JSON.stringify(r[`${k}_url`])} status=${r[`${k}_status`]} flag=${r[k === "license" ? "is_licensed" : "is_insured"]}`;

// 1. member writes ' ' as a licence
await seed(M(1));
await asUser(M(1), "license_url = $2", [" "]);
let r = await row(M(1));
check("member ' ' licence -> none / false / NULL", r.license_status === "none" && r.is_licensed === false && r.license_url === null, show(r, "license"));

// 2. member writes tab/newline as insurance
await seed(M(2));
await asUser(M(2), "insurance_url = $2", [" \t\n "]);
r = await row(M(2));
check("member tab/newline insurance -> none / false / NULL", r.insurance_status === "none" && r.is_insured === false && r.insurance_url === null, show(r, "insurance"));

// 3. a real path still submits
const PATH = `${M(3)}/credentials/license-1.pdf`;
await seed(M(3));
await asUser(M(3), "license_url = $2", [PATH]);
r = await row(M(3));
check("member real path -> pending / true, stored as written", r.license_status === "pending" && r.is_licensed === true && r.license_url === PATH, show(r, "license"));

// 4. withdrawing a real document by writing spaces clears it
await asUser(M(3), "license_url = $2", ["   "]);
r = await row(M(3));
check("member real -> '   ' withdraws: none / false / NULL", r.license_status === "none" && r.is_licensed === false && r.license_url === null, show(r, "license"));

// 5. a real path with surrounding spaces is a document (kept as written)
await seed(M(4));
await asUser(M(4), "insurance_url = $2", [" x/coi.pdf "]);
r = await row(M(4));
check("member ' x/coi.pdf ' -> pending / true, not trimmed", r.insurance_status === "pending" && r.is_insured === true && r.insurance_url === " x/coi.pdf ", show(r, "insurance"));

// 6. verified from helper_credentials (profile URL NULL): ' ' leaves the badge alone
await seed(M(5), { license_status: "verified", is_licensed: true });
await asUser(M(5), "license_url = $2", [" "]);
r = await row(M(5));
check("verified (URL NULL) + member ' ' -> still verified / true, URL NULL", r.license_status === "verified" && r.is_licensed === true && r.license_url === null, show(r, "license"));

// 7. admin writing ' ' does not claim a licence
await seed(M(6));
await asAdmin(M(6), "license_url = $2", [" "]);
r = await row(M(6));
check("admin ' ' -> is_licensed false, URL NULL", r.is_licensed === false && r.license_url === null && r.license_status === "none", show(r, "license"));

// 8. the rename re-review is unchanged
await seed(M(7), { license_status: "verified", is_licensed: true, license_url: "p/l.pdf", business_name: "A" });
await asUser(M(7), "business_name = $2", ["B"]);
r = await row(M(7));
check("rename of a verified badge still re-enters review", r.license_status === "pending" && r.is_licensed === true, show(r, "license"));

// 9. the member cannot write the status directly (prevent_self_escalation still first)
await seed(M(8));
await asUser(M(8), "license_status = $2, is_licensed = true", ["verified"]);
r = await row(M(8));
check("member cannot self-grant a status", r.license_status === "none" && r.is_licensed === false, show(r, "license"));

// 10. function shape
const [fn] = await q(`SELECT prosecdef, proconfig, coalesce(proacl::text, '') AS acl FROM pg_proc WHERE proname = 'auto_pending_credentials'`);
check("SECURITY DEFINER, search_path=public", fn.prosecdef === true && (fn.proconfig ?? []).includes("search_path=public"), JSON.stringify(fn.proconfig));
check("no EXECUTE for PUBLIC / anon / authenticated", !/(^|[{,])=X|anon=|authenticated=/.test(fn.acl), fn.acl);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
