#!/usr/bin/env node
/**
 * PGlite proof for 20261004194257_pre_verification_takeover_wipe (docs/OPEN.md Q447(a),
 * owner decision 2026-10-04).
 *
 *   node src/test/pglite/preVerificationTakeoverWipe.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/preVerificationTakeoverWipe.pglite.mjs # RED: the state on main
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * The row writes are GoTrue's, in its order (scripts/sql/identity-linking-
 * scenarios.sql, from internal/models/linking.go + external.go read
 * 2026-09-25): B = an UNconfirmed email account + Google with the same
 * verified email -> provider identity INSERT, password NULL + metadata swap,
 * email identity DELETE, providers update, then email_confirmed_at := now().
 * The profile triggers that fire on the wipe's UPDATE are the live bodies that
 * can change or refuse it (preserve_first_consent from 20260901035252,
 * auto_pending_credentials and derive_profile_parish read from pg_proc
 * 2026-10-04 with their lookups stubbed); storage.objects carries a stand-in
 * for storage.protect_delete (a DELETE from SQL is refused, as live).
 * Last, the shared scenario script scripts/sql/identity-linking-scenarios.sql
 * (the guard Q447 names) runs verbatim on this fixture.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const MIGDIR = "../../../supabase/migrations/";
const NEW = read(`${MIGDIR}20261004194257_pre_verification_takeover_wipe.sql`);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state on main (expect FAILs)`);

function cut(file, name) {
  const sql = read(MIGDIR + file);
  const m = [...sql.matchAll(new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi"))].at(-1);
  const open = /\bAS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
  const bodyStart = m.index + open.index + open[0].length;
  const close = sql.indexOf(open[1], bodyStart);
  return sql.slice(m.index, sql.indexOf(";", close) + 1);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
CREATE TABLE auth.users (instance_id uuid, aud text, role text, id uuid PRIMARY KEY, email text, encrypted_password text, email_confirmed_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE auth.identities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_id text, user_id uuid, identity_data jsonb, provider text,
  last_sign_in_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), UNIQUE (bucket_id, name));
CREATE FUNCTION storage.protect_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'; END $$;
CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE NOT NULL, full_name text, phone text, location text, bio text,
  avatar_url text, skills text, email text, date_of_birth date, availability text, transportation text, hear_about_us text,
  experience_level text, tools_equipment text, emergency_contact_name text, emergency_contact_phone text, extra_comments text,
  parish text, zip_code text, parish_source text, email_verified boolean NOT NULL DEFAULT false,
  is_licensed boolean NOT NULL DEFAULT false, is_insured boolean NOT NULL DEFAULT false, license_url text, insurance_url text,
  license_status text NOT NULL DEFAULT 'none', insurance_status text NOT NULL DEFAULT 'none',
  license_reviewed_at timestamptz, insurance_reviewed_at timestamptz, license_reviewed_by uuid, insurance_reviewed_by uuid,
  license_rejection_reason text, insurance_rejection_reason text, license_expires_at date, insurance_expires_at date,
  business_name text, marketing_consent boolean NOT NULL DEFAULT false, terms_version_accepted text NOT NULL DEFAULT '',
  terms_accepted_at timestamptz, accepted_terms_at timestamptz, ban_status text DEFAULT 'active');
CREATE TABLE public.legal_acceptances (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, terms_version text, marketing_opted_in boolean, created_at timestamptz DEFAULT now());
CREATE TABLE public.referrals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), referrer_id uuid, referred_id uuid UNIQUE, created_at timestamptz DEFAULT now());
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
-- Stubs for derive_profile_parish's lookups.
-- The real gate is proven by unconfirmedEmailWritesRefused.pglite.mjs; the migration calls it (Q807).
CREATE FUNCTION public.attach_unconfirmed_email_gate() RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.get_parish_for_zip(p text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT CASE WHEN p = '70112' THEN 'Orleans' END $$;
CREATE FUNCTION public.get_parish_for_city(p text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.credential_document_path_ok(u uuid, kind text, p text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT p LIKE u::text || '/credentials/' || kind || '-%' $$;

-- handle_new_user's profile write and sync_email_verified, as live.
CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email) VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), NEW.email);
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
CREATE FUNCTION public.sync_email_verified() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF (OLD.email_confirmed_at IS NULL) IS DISTINCT FROM (NEW.email_confirmed_at IS NULL) THEN
    UPDATE public.profiles SET email_verified = (NEW.email_confirmed_at IS NOT NULL) WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sync_email_verified_trigger AFTER UPDATE OF email_confirmed_at ON auth.users FOR EACH ROW EXECUTE FUNCTION public.sync_email_verified();

-- auto_pending_credentials and derive_profile_parish: live bodies (pg_proc 2026-10-04).
CREATE FUNCTION public.auto_pending_credentials() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  is_admin_writer boolean := (auth.uid() IS NOT NULL AND has_role(auth.uid(), 'admin'));
BEGIN
  IF NEW.license_url IS DISTINCT FROM OLD.license_url THEN
    IF coalesce(NEW.license_url, '') !~ '[^[:space:]]' THEN NEW.license_url := NULL; END IF;
    IF NEW.license_url IS NOT DISTINCT FROM OLD.license_url THEN NULL;
    ELSIF NEW.license_url IS NOT NULL THEN
      IF NOT public.credential_document_path_ok(NEW.user_id, 'license', NEW.license_url) THEN RAISE EXCEPTION 'license_url must be a document you uploaded' USING ERRCODE = '22023'; END IF;
      NEW.is_licensed := true;
      IF NOT is_admin_writer THEN NEW.license_status := 'pending'; NEW.license_reviewed_at := NULL; NEW.license_reviewed_by := NULL; NEW.license_rejection_reason := NULL; END IF;
    ELSE NEW.license_status := 'none'; NEW.is_licensed := false;
    END IF;
  END IF;
  IF NEW.insurance_url IS DISTINCT FROM OLD.insurance_url THEN
    IF coalesce(NEW.insurance_url, '') !~ '[^[:space:]]' THEN NEW.insurance_url := NULL; END IF;
    IF NEW.insurance_url IS NOT DISTINCT FROM OLD.insurance_url THEN NULL;
    ELSIF NEW.insurance_url IS NOT NULL THEN
      IF NOT public.credential_document_path_ok(NEW.user_id, 'insurance', NEW.insurance_url) THEN RAISE EXCEPTION 'insurance_url must be a document you uploaded' USING ERRCODE = '22023'; END IF;
      NEW.is_insured := true;
      IF NOT is_admin_writer THEN NEW.insurance_status := 'pending'; NEW.insurance_reviewed_at := NULL; NEW.insurance_reviewed_by := NULL; NEW.insurance_rejection_reason := NULL; END IF;
    ELSE NEW.insurance_status := 'none'; NEW.is_insured := false;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_auto_pending_credentials BEFORE UPDATE ON public.profiles FOR EACH ROW
  WHEN (((old.license_url IS DISTINCT FROM new.license_url) OR (old.insurance_url IS DISTINCT FROM new.insurance_url) OR (old.business_name IS DISTINCT FROM new.business_name)))
  EXECUTE FUNCTION public.auto_pending_credentials();
CREATE FUNCTION public.derive_profile_parish() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_parish text;
BEGIN
  v_parish := public.get_parish_for_zip(NEW.zip_code);
  IF v_parish IS NOT NULL THEN NEW.parish := v_parish; NEW.parish_source := 'zip'; RETURN NEW; END IF;
  v_parish := public.get_parish_for_city(NEW.location);
  IF v_parish IS NOT NULL THEN NEW.parish := v_parish; NEW.parish_source := 'city'; RETURN NEW; END IF;
  NEW.parish := NULL; NEW.parish_source := NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_derive_profile_parish BEFORE INSERT OR UPDATE OF zip_code, location, parish, parish_source ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.derive_profile_parish();
`);
await db.exec(cut("20260901035252_signup_consent_referral_integrity.sql", "preserve_first_consent"));
await db.exec(`CREATE TRIGGER tr_preserve_first_consent BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.preserve_first_consent();`);
let replay = "ok";
if (MODE !== "skip") { try { for (let i = 0; i < 3; i++) await db.exec(NEW); } catch (e) { replay = e.message; } }
check("A0 the migration replays 3x", replay === "ok", replay);

const uid = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SIGNED_UP = "2026-10-04T10:00:00Z";
// An email/password signup, then complete-signup's unauthenticated fill (what an attacker types).
async function emailSignup(u, email, confirmed) {
  await db.exec(`
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at)
VALUES ('${u}', '${email}', '$2a$10$x', ${confirmed ? "now()" : "NULL"}, '{"provider":"email","providers":["email"]}', '{"full_name":"Typed Name"}', '${SIGNED_UP}');
INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at) VALUES ('${u}', '${u}', '{"email":"${email}"}', 'email', '${SIGNED_UP}');
UPDATE public.profiles SET full_name = 'Typed Name', phone = '(504) 555-0118', date_of_birth = '1990-01-18', avatar_url = 'https://x/avatars/${u}/avatar.jpg',
  location = 'New Orleans', zip_code = '70112', bio = 'typed bio', skills = 'mowing', emergency_contact_name = 'Pal',
  license_url = '${u}/credentials/license-1.pdf', insurance_url = '${u}/credentials/insurance-1.pdf',
  marketing_consent = true, terms_version_accepted = 'v9', terms_accepted_at = now(), accepted_terms_at = now()
 WHERE user_id = '${u}';
INSERT INTO public.legal_acceptances (user_id, terms_version, marketing_opted_in) VALUES ('${u}', 'v9', true);
INSERT INTO public.referrals (referrer_id, referred_id) VALUES (gen_random_uuid(), '${u}');
INSERT INTO storage.objects (bucket_id, name, created_at, updated_at) VALUES
  ('avatars', '${u}/avatar.jpg', '${SIGNED_UP}', '${SIGNED_UP}'),
  ('user-documents', '${u}/credentials/license-1.pdf', '${SIGNED_UP}', '${SIGNED_UP}'),
  ('user-documents', '${u}/credentials/insurance-1.pdf', '${SIGNED_UP}', '${SIGNED_UP}');
`);
}
// GoTrue's case B, row by row.
async function googleTakeover(u, email) {
  await db.exec(`
INSERT INTO auth.identities (provider_id, user_id, identity_data, provider) VALUES ('g-${u}', '${u}', '{"email":"${email}","email_verified":true}', 'google');
UPDATE auth.users SET encrypted_password = NULL, raw_user_meta_data = '{"full_name":"Google Name"}', updated_at = now() WHERE id = '${u}';
DELETE FROM auth.identities WHERE user_id = '${u}' AND provider = 'email';
UPDATE auth.users SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"providers":["google"]}'::jsonb WHERE id = '${u}';
UPDATE auth.users SET email_confirmed_at = now(), updated_at = now() WHERE id = '${u}';
`);
}
const prof = async (u) => (await db.query(`SELECT * FROM public.profiles WHERE user_id = '${u}'`)).rows[0];
const n = async (t, col, u) => (await db.query(`SELECT count(*)::int AS n FROM ${t} WHERE ${col} = '${u}'`)).rows[0].n;
const wipes = async (u) => (await db.query(`SELECT * FROM public.pre_verification_wipes WHERE user_id = '${u}'`).catch(() => ({ rows: [] }))).rows;

// ── B: the takeover deletes everything typed before verification (RED: all kept) ──
{
  const B = uid(1);
  await emailSignup(B, "victim@example.com", false);
  await googleTakeover(B, "victim@example.com");
  const p = await prof(B);
  check("B1 the email is confirmed and the profile row is the same one", p.email_verified === true);
  const typed = ["phone", "date_of_birth", "avatar_url", "location", "zip_code", "parish", "bio", "skills", "emergency_contact_name", "license_url", "insurance_url", "terms_accepted_at", "accepted_terms_at"];
  const kept = typed.filter((c) => p[c] !== null);
  check("B2 every typed profile field is cleared", kept.length === 0 && p.full_name === "", kept.length ? `kept: ${kept.join(", ")}; full_name=${p.full_name}` : "");
  check("B3 consent and credential state reset (marketing off, no terms version, no license/insurance claim)",
    p.marketing_consent === false && p.terms_version_accepted === "" && p.license_status === "none" && p.insurance_status === "none" && p.is_licensed === false && p.is_insured === false,
    JSON.stringify({ m: p.marketing_consent, t: p.terms_version_accepted, ls: p.license_status, is: p.insurance_status }));
  check("B4 the legal_acceptances rows are deleted", (await n("public.legal_acceptances", "user_id", B)) === 0);
  check("B5 the signup referral is deleted", (await n("public.referrals", "referred_id", B)) === 0);
  const w = await wipes(B);
  check("B6 the wipe is recorded with the three stored objects to remove", w.length === 1 && w[0].objects.length === 3 && w[0].error === null, JSON.stringify(w[0]?.objects ?? null));
  // The real owner uploads a NEW avatar under the same key after the wipe.
  await db.exec(`UPDATE storage.objects SET updated_at = now() + interval '1 minute' WHERE bucket_id = 'avatars' AND name = '${B}/avatar.jpg'`);
  const left = MODE === "skip" ? [] : (await db.query(`SELECT bucket, name FROM public.pre_verification_wipe_objects('${w[0]?.id ?? B}')`)).rows;
  check("B7 the sweep is handed the two pre-verification documents, never the real owner's new avatar",
    left.length === 2 && left.every((r) => r.bucket === "user-documents"), JSON.stringify(left));
}
// ── A: a VERIFIED account adding Google keeps everything ───────────────────
{
  const A = uid(2);
  await emailSignup(A, "owner@example.com", true);
  await db.exec(`INSERT INTO auth.identities (provider_id, user_id, identity_data, provider) VALUES ('g-${A}', '${A}', '{}', 'google');
                 UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"providers":["email","google"]}'::jsonb WHERE id = '${A}';`);
  const p = await prof(A);
  check("A1 a verified account that links Google keeps its profile, legal row and referral",
    p.phone === "(504) 555-0118" && (await n("public.legal_acceptances", "user_id", A)) === 1 && (await n("public.referrals", "referred_id", A)) === 1 && (await wipes(A)).length === 0);
}
// ── E: an ordinary email-link verification keeps everything ────────────────
{
  const E = uid(3);
  await emailSignup(E, "linkclick@example.com", false);
  await db.exec(`UPDATE auth.users SET email_confirmed_at = now() WHERE id = '${E}'`);
  const p = await prof(E);
  check("E1 confirming by the email link keeps the profile (the email identity is still there)",
    p.email_verified === true && p.phone === "(504) 555-0118" && p.accepted_terms_at !== null && (await wipes(E)).length === 0);
}
// ── C: Apple "Hide My Email" creates its own account; nothing to take over ──
{
  const C = uid(4);
  await db.exec(`
INSERT INTO auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) VALUES ('${C}', 'x@privaterelay.appleid.com', NULL, '{"provider":"apple","providers":["apple"]}', '{"full_name":"Apple Name"}');
INSERT INTO auth.identities (provider_id, user_id, identity_data, provider) VALUES ('a-${C}', '${C}', '{}', 'apple');
UPDATE auth.users SET email_confirmed_at = now() WHERE id = '${C}';`);
  const p = await prof(C);
  check("C1 a provider-created account keeps the name the provider gave it", p.full_name === "Apple Name" && (await wipes(C)).length === 0, p.full_name);
}
// ── F: a failing wipe never breaks the sign-in, and is recorded ────────────
if (MODE !== "skip") {
  const F = uid(5);
  await emailSignup(F, "fail@example.com", false);
  await db.exec(`CREATE FUNCTION public.zz_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$;
                 CREATE TRIGGER zz_boom BEFORE DELETE ON public.referrals FOR EACH ROW EXECUTE FUNCTION public.zz_boom();`);
  let signin = "ok";
  try { await googleTakeover(F, "fail@example.com"); } catch (e) { signin = e.message; }
  const w = await wipes(F);
  const p = await prof(F);
  check("F1 the confirm still commits when the wipe fails", signin === "ok" && p.email_verified === true, signin);
  check("F2 ...the failure is recorded for an operator, and nothing is half-wiped", w.length === 1 && /wipe failed: boom/.test(w[0].error ?? "") && p.phone === "(504) 555-0118", JSON.stringify(w[0] ?? null));
}

// ── The shared scenario script (db-smoke + nightly on prod, rolled back) ──
// scripts/sql/identity-linking-scenarios.sql, run verbatim on this fixture:
// it always ends in RAISE EXCEPTION with its verdict, so nothing it writes stays.
{
  const SCEN = read("../../../scripts/sql/identity-linking-scenarios.sql");
  let verdict = null;
  try { await db.exec(SCEN); } catch (e) { const m = /OA018_RESULT:(\{.*\})/s.exec(e.message); verdict = m ? JSON.parse(m[1]) : { error: e.message }; }
  const bad = (verdict?.checks ?? []).filter((c) => !c.ok).map((c) => `${c.case}: ${c.check} (${JSON.stringify(c.got)})`);
  check("S1 the identity-linking scenarios all hold, case B now expecting the wipe", Array.isArray(verdict?.checks) && verdict.checks.length >= 10 && bad.length === 0,
    verdict?.error ?? (bad.join("; ") || `${verdict.checks.length} checks`));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
