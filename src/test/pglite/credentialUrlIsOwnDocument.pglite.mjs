#!/usr/bin/env node
/**
 * PGlite proof for 20260923110759_credential_url_is_own_document (docs/OPEN.md Q127).
 *
 *   node src/test/pglite/credentialUrlIsOwnDocument.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/credentialUrlIsOwnDocument.pglite.mjs   # RED: live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the LIVE prod chain (2026-09-23):
 *   - tr_prevent_self_escalation: live body (pg_get_functiondef; comments
 *     stripped), fires first (BEFORE UPDATE triggers run in name order);
 *   - trg_auto_pending_credentials with its live WHEN clause, body = migration
 *     20260923104534 (md5 of its whitespace-normalised body == live prosrc,
 *     645cefe3f391b538991a991ce3e34e39);
 *   - storage.objects with the live storage.foldername() and the seven live
 *     user-documents policies (pg_policies), RLS on.
 * The new migration is applied 3x (replay-safe), then:
 *   - U+200B, U+FEFF, U+2060, another member's folder, a URL, a bare file
 *     name, a right-shaped path with no object, a licence path in the
 *     insurance column, a trailing ZWSP and a disallowed extension are all
 *     REFUSED and the row is unchanged (RED on live: each is accepted);
 *   - the app's real path (object uploaded first) gives 'pending' + true,
 *     an upper-case extension from an older client too;
 *   - whitespace is still absent (Q120), withdraw still clears;
 *   - service-role writes (complete-signup) must satisfy the same shape;
 *   - storage: the member cannot UPDATE (upsert over) or DELETE the object
 *     their profile names, can still delete any other own object, and can
 *     delete the old one after withdrawing it (RED on live: both work).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const LIVE_TRIGGER = mig("20260923104534_blank_credential_url_is_absent.sql");
const NEW = mig("20260923110759_credential_url_is_own_document.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ADMIN = "aaaaaaaa-0000-0000-0000-00000000000a";
const M = (n) => `11111111-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;

const PSE_TEXT_COLS = `
  subscription_tier, subscription_expires_at, stripe_customer_id, stripe_subscription_id,
  subscription_billing_cycle, subscription_cancel_at_period_end, apple_original_transaction_id,
  approval_status, ban_status, stripe_account_id, denial_reason, denial_email_count,
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

  NEW.approval_status := OLD.approval_status;
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

-- Live storage (pg_get_functiondef / pg_policies 2026-09-23).
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA storage TO authenticated, anon, service_role;
CREATE TABLE storage.objects (id bigserial PRIMARY KEY, bucket_id text, name text, owner uuid, metadata jsonb, UNIQUE (bucket_id, name));
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT USAGE ON SEQUENCE storage.objects_id_seq TO authenticated;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE _parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1 : array_length(_parts,1) - 1];
END
$function$;
CREATE POLICY "Owner delete user-documents" ON storage.objects FOR DELETE TO public
  USING ((bucket_id = 'user-documents'::text) AND ((auth.uid())::text = (storage.foldername(name))[1]));
CREATE POLICY "Owner update user-documents" ON storage.objects FOR UPDATE TO public
  USING ((bucket_id = 'user-documents'::text) AND ((auth.uid())::text = (storage.foldername(name))[1]));
CREATE POLICY "Owner upload user-documents" ON storage.objects FOR INSERT TO public
  WITH CHECK ((bucket_id = 'user-documents'::text) AND ((auth.uid())::text = (storage.foldername(name))[1]));
CREATE POLICY "Users can delete their own documents" ON storage.objects FOR DELETE TO authenticated
  USING ((bucket_id = 'user-documents'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text));
CREATE POLICY "Users can update their own documents" ON storage.objects FOR UPDATE TO public
  USING ((bucket_id = 'user-documents'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))
  WITH CHECK ((bucket_id = 'user-documents'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text));
CREATE POLICY "Users can upload their own documents" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'user-documents'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text));
CREATE POLICY "user-documents: owner or admin read" ON storage.objects FOR SELECT TO authenticated
  USING ((bucket_id = 'user-documents'::text) AND (((auth.uid())::text = (storage.foldername(name))[1]) OR has_role(auth.uid(), 'admin'::app_role)));

-- Members read/update their own profile row (the part of profiles RLS this proof needs).
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_select ON public.profiles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY own_update ON public.profiles FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
REVOKE ALL ON FUNCTION public.prevent_self_escalation() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER tr_prevent_self_escalation BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION prevent_self_escalation();
`);
// The LIVE auto_pending_credentials (Q120 migration == live prosrc), then its live trigger.
await db.exec(LIVE_TRIGGER);
await db.exec(`
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
const putObject = (name) => q(`INSERT INTO storage.objects (bucket_id, name) VALUES ('user-documents', $1)`, [name]);
/** Run SQL as a signed-in member (role authenticated); returns { rows, error }. */
const asMember = async (uid, sql, params = []) => {
  await db.exec(`SET ROLE authenticated`);
  await q(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  try {
    return { rows: await q(sql, params), error: null };
  } catch (e) {
    return { rows: [], error: e };
  } finally {
    await db.exec(`RESET ROLE`);
    await q(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
};
const memberSet = (uid, col, v) => asMember(uid, `UPDATE public.profiles SET ${col} = $2 WHERE user_id = $1 RETURNING user_id`, [uid, v]);
/** Server context (complete-signup: service role, no uid). */
const serverSet = async (uid, col, v) => {
  try {
    await q(`UPDATE public.profiles SET ${col} = $2 WHERE user_id = $1`, [uid, v]);
    return null;
  } catch (e) {
    return e;
  }
};
const row = async (uid) => (await q(`SELECT * FROM public.profiles WHERE user_id = $1`, [uid]))[0];
const show = (r, k) => `url=${JSON.stringify(r[`${k}_url`])} status=${r[`${k}_status`]} flag=${r[k === "license" ? "is_licensed" : "is_insured"]}`;
const path = (uid, kind, ext = "pdf") => `${uid}/credentials/${kind}-1790000000000.${ext}`;

// ── Refused values: each must raise and leave the row at none / false / NULL ──
// [label, column, value(uid), upload an object at that exact name first?]
const refused = [
  ["U+200B zero-width space", "license_url", () => "​", false],
  ["U+FEFF byte-order mark", "license_url", () => "﻿", false],
  ["U+2060 word joiner", "insurance_url", () => "⁠", false],
  ["another member's folder (object exists)", "license_url", () => path(M(99), "license"), false],
  ["a URL", "license_url", () => "https://evil.example/license.pdf", false],
  ["a bare file name", "insurance_url", () => "insurance.pdf", false],
  ["right shape, no uploaded object", "license_url", (u) => `${u}/credentials/license-1790000000001.pdf`, false],
  ["licence path in insurance_url", "insurance_url", (u) => path(u, "license"), true],
  ["own path + trailing ZWSP", "license_url", (u) => `${path(u, "license")}​`, true],
  ["own path with a disallowed extension", "license_url", (u) => path(u, "license", "html"), true],
];
await putObject(path(M(99), "license"));
let n = 10;
for (const [label, col, make, upload] of refused) {
  const uid = M(n++);
  await seed(uid);
  const v = make(uid);
  if (upload) await putObject(v);
  const { error } = await memberSet(uid, col, v);
  const r = await row(uid);
  const kind = col.startsWith("license") ? "license" : "insurance";
  const clean = r[`${kind}_status`] === "none" && r[kind === "license" ? "is_licensed" : "is_insured"] === false && r[col] === null;
  check(`member ${label} -> refused, row unchanged`, !!error && clean, error ? `${error.code} ${show(r, kind)}` : `accepted: ${show(r, kind)}`);
}

// ── Accepted: the app's real shape ──
{
  const uid = M(40);
  await seed(uid);
  const p = path(uid, "license");
  await putObject(p);
  const { error } = await memberSet(uid, "license_url", p);
  const r = await row(uid);
  check("member real path (uploaded) -> pending / true, stored as written", !error && r.license_status === "pending" && r.is_licensed === true && r.license_url === p, error?.message ?? show(r, "license"));
}
{
  const uid = M(41);
  await seed(uid);
  const p = path(uid, "insurance", "JPG");
  await putObject(p);
  const { error } = await memberSet(uid, "insurance_url", p);
  const r = await row(uid);
  check("member older-client path with .JPG -> pending / true", !error && r.insurance_status === "pending" && r.is_insured === true, error?.message ?? show(r, "insurance"));
}

// ── Q120 unchanged: whitespace is absent, withdraw clears ──
{
  const uid = M(42);
  await seed(uid);
  const { error } = await memberSet(uid, "license_url", " \t ");
  const r = await row(uid);
  check("member whitespace -> none / false / NULL (Q120)", !error && r.license_status === "none" && r.license_url === null, error?.message ?? show(r, "license"));
  const p = path(uid, "license");
  await putObject(p);
  await memberSet(uid, "license_url", p);
  const w = await memberSet(uid, "license_url", null);
  const r2 = await row(uid);
  check("member withdraw (NULL) -> none / false", !w.error && r2.license_status === "none" && r2.is_licensed === false, w.error?.message ?? show(r2, "license"));
}

// ── Server context (complete-signup) satisfies the same shape ──
{
  const uid = M(43);
  await seed(uid);
  const bad = await serverSet(uid, "license_url", "​");
  let r = await row(uid);
  check("service role ZWSP -> refused", !!bad && r.license_url === null && r.is_licensed === false, bad ? bad.code : show(r, "license"));
  const p = path(uid, "license", "heic");
  await putObject(p);
  const ok = await serverSet(uid, "license_url", p);
  r = await row(uid);
  check("service role real path -> pending / true", !ok && r.license_status === "pending" && r.is_licensed === true, ok?.message ?? show(r, "license"));
}

// ── Unchanged behaviour ──
{
  const uid = M(44);
  // A stored URL that would fail today's shape is never re-checked on an unrelated write.
  await seed(uid, { license_status: "verified", is_licensed: true, license_url: "legacy/l.pdf", business_name: "A" });
  const { error } = await asMember(uid, `UPDATE public.profiles SET business_name = 'B' WHERE user_id = $1`, [uid]);
  const r = await row(uid);
  check("rename of a verified badge re-enters review; off-shape stored URL not re-checked", !error && r.license_status === "pending" && r.is_licensed === true, error?.message ?? show(r, "license"));
}
{
  const uid = M(45);
  await seed(uid);
  await asMember(uid, `UPDATE public.profiles SET license_status = 'verified', is_licensed = true WHERE user_id = $1`, [uid]);
  const r = await row(uid);
  check("member cannot self-grant a status", r.license_status === "none" && r.is_licensed === false, show(r, "license"));
}

// ── Storage: a submitted document cannot be swapped under its path ──
{
  const uid = M(50);
  const p = path(uid, "license");
  const other = `${uid}/portfolio/photo.jpg`;
  await putObject(p);
  await putObject(other);
  await seed(uid, { license_status: "verified", is_licensed: true, license_url: p });
  const upd = await asMember(uid, `UPDATE storage.objects SET metadata = '{"swapped":true}' WHERE bucket_id='user-documents' AND name = $1 RETURNING id`, [p]);
  check("member cannot overwrite (upsert) the verified object", upd.rows.length === 0, `rows=${upd.rows.length} ${upd.error?.message ?? ""}`);
  const del = await asMember(uid, `DELETE FROM storage.objects WHERE bucket_id='user-documents' AND name = $1 RETURNING id`, [p]);
  check("member cannot delete (then re-upload) the verified object", del.rows.length === 0, `rows=${del.rows.length}`);
  const delOther = await asMember(uid, `DELETE FROM storage.objects WHERE bucket_id='user-documents' AND name = $1 RETURNING id`, [other]);
  check("member can still delete another own object", delOther.rows.length === 1, `rows=${delOther.rows.length} ${delOther.error?.message ?? ""}`);
  const foreign = await asMember(M(51), `DELETE FROM storage.objects WHERE bucket_id='user-documents' AND name = $1 RETURNING id`, [p]);
  check("another member cannot delete it", foreign.rows.length === 0, `rows=${foreign.rows.length}`);
  await memberSet(uid, "license_url", null);
  const r = await row(uid);
  const after = await asMember(uid, `DELETE FROM storage.objects WHERE bucket_id='user-documents' AND name = $1 RETURNING id`, [p]);
  check("after withdrawing (badge gone) the member can delete it", r.is_licensed === false && after.rows.length === 1, `${show(r, "license")} rows=${after.rows.length}`);
}

// ── Function / policy shape ──
{
  const fns = await q(`SELECT proname, prosecdef, proconfig, coalesce(proacl::text, '') AS acl FROM pg_proc
                        WHERE proname IN ('auto_pending_credentials','credential_document_path_ok','is_submitted_credential_object')`);
  const by = Object.fromEntries(fns.map((f) => [f.proname, f]));
  const apc = by.auto_pending_credentials;
  check("auto_pending_credentials: SECURITY DEFINER, search_path=public, no client EXECUTE",
    apc.prosecdef && (apc.proconfig ?? []).includes("search_path=public") && !/(^|[{,])=X|anon=|authenticated=/.test(apc.acl), apc.acl);
  const ok = by.credential_document_path_ok;
  check("credential_document_path_ok exists, no client EXECUTE", !!ok && !/(^|[{,])=X|anon=|authenticated=/.test(ok.acl), ok?.acl ?? "missing");
  const sc = by.is_submitted_credential_object;
  check("is_submitted_credential_object: authenticated only", !!sc && /authenticated=X/.test(sc.acl) && !/(^|[{,])=X|anon=/.test(sc.acl), sc?.acl ?? "missing");
  const pols = (await q(`SELECT policyname FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND cmd IN ('UPDATE','DELETE') ORDER BY 1`)).map((p) => p.policyname);
  check("exactly the two guarded UPDATE/DELETE policies remain",
    JSON.stringify(pols) === JSON.stringify(["user-documents: owner delete, not a submitted credential", "user-documents: owner update, not a submitted credential"]), JSON.stringify(pols));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
