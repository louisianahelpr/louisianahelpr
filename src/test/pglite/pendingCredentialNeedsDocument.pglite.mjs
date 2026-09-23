#!/usr/bin/env node
/**
 * PGlite proof for 20260923101130_pending_credential_requires_document (docs/OPEN.md Q102).
 *
 *   node src/test/pglite/pendingCredentialNeedsDocument.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/pendingCredentialNeedsDocument.pglite.mjs   # RED: unfixed chain
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the LIVE prod shape of public.helper_credentials on 2026-09-23
 * (columns, the two enum CHECKs, RLS policies, enforce_credential_status_server_owned
 * verbatim from pg_get_functiondef) and the live get_pending_credentials() as
 * the "before". Applies the new migration 3x (replay-safe), then proves:
 *   - a member INSERT of a trade_license / insurance with no (or a blank)
 *     document_url is refused (check_violation);
 *   - a member INSERT with a document still works (the CredentialsTab /
 *     prod-audit harness / prod-seed shape);
 *   - a server INSERT of a document-less background_check 'submitted'
 *     (stripe-webhook) still works; expired / rejected rows need no document
 *     (prod-seed's insurance + bond rows);
 *   - clearing the document of a pending row is refused;
 *   - get_pending_credentials() never returns a person without an actionable
 *     credential (pending AND a document), including a profiles-mirror
 *     'pending' with no URL, and non-admins get nothing.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(
  new URL("../../../supabase/migrations/20260923101130_pending_credential_requires_document.sql", import.meta.url).pathname,
  "utf8",
);
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the UNFIXED chain (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ADMIN = "aaaaaaaa-0000-0000-0000-00000000000a";
const H1 = "11111111-0000-0000-0000-000000000001"; // submits with a document
const H2 = "22222222-0000-0000-0000-000000000002"; // tries without one
const H3 = "33333333-0000-0000-0000-000000000003"; // profiles mirror 'pending', no URL
const H4 = "44444444-0000-0000-0000-000000000004"; // background check, expired / rejected rows

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
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TYPE public.app_role AS ENUM ('admin','customer','helper');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE OR REPLACE FUNCTION public.has_role(_uid uuid, _role public.app_role) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = _role) $$;
-- Live is_server_context (pg_get_functiondef 2026-09-23), minus auth.role() which this fixture lacks.
CREATE OR REPLACE FUNCTION public.is_server_context() RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS
  $$ SELECT auth.uid() IS NULL
       AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated') $$;
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY, full_name text, email text, avatar_url text,
  license_url text, insurance_url text, license_status text DEFAULT 'none', insurance_status text DEFAULT 'none',
  is_licensed boolean DEFAULT false, is_insured boolean DEFAULT false, business_name text,
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.helper_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_type text NOT NULL CONSTRAINT helper_credentials_credential_type_check
    CHECK (credential_type = ANY (ARRAY['identity','background_check','trade_license','insurance','bond'])),
  status text NOT NULL DEFAULT 'unverified' CONSTRAINT helper_credentials_status_check
    CHECK (status = ANY (ARRAY['unverified','submitted','verified','expired','rejected'])),
  license_number text, license_state text DEFAULT 'LA', trade_category text, issuing_authority text,
  document_url text, expiration_date date, verified_at timestamptz, rejection_reason text,
  vendor_check_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.helper_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can insert own credentials" ON public.helper_credentials FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can update own credentials" ON public.helper_credentials FOR UPDATE USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can view own credentials" ON public.helper_credentials FOR SELECT USING ((SELECT auth.uid()) = user_id);
GRANT SELECT, INSERT, UPDATE ON public.helper_credentials TO authenticated;
GRANT SELECT ON public.profiles, public.user_roles TO authenticated;

-- Live enforce_credential_status_server_owned, verbatim (pg_get_functiondef 2026-09-23).
CREATE OR REPLACE FUNCTION public.enforce_credential_status_server_owned()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_server_context() OR has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;
  IF current_setting('app.trusted_ladder_write', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.user_id          := auth.uid();
    NEW.status           := 'submitted';
    NEW.verified_at      := NULL;
    NEW.rejection_reason := NULL;
    NEW.vendor_check_id  := NULL;
    RETURN NEW;
  END IF;
  IF OLD.status = 'verified' THEN
    RETURN OLD;
  END IF;
  NEW.user_id          := OLD.user_id;
  NEW.status           := OLD.status;
  NEW.verified_at      := OLD.verified_at;
  NEW.rejection_reason := OLD.rejection_reason;
  NEW.vendor_check_id  := OLD.vendor_check_id;
  NEW.created_at       := OLD.created_at;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_credential_status_server_owned BEFORE INSERT OR UPDATE ON public.helper_credentials
  FOR EACH ROW EXECUTE FUNCTION enforce_credential_status_server_owned();

-- Live get_pending_credentials, verbatim (pg_get_functiondef 2026-09-23) = the "before".
CREATE OR REPLACE FUNCTION public.get_pending_credentials()
 RETURNS TABLE(user_id uuid, full_name text, email text, avatar_url text, license_url text, insurance_url text, license_status text, insurance_status text, is_licensed boolean, is_insured boolean, business_name text, submitted_at timestamp with time zone)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH hc AS (
    SELECT
      c.user_id,
      MAX(c.document_url)   FILTER (WHERE c.credential_type = 'trade_license') AS license_url,
      MAX(c.document_url)   FILTER (WHERE c.credential_type = 'insurance')     AS insurance_url,
      bool_or(c.credential_type = 'trade_license')                             AS has_license,
      bool_or(c.credential_type = 'insurance')                                 AS has_insurance,
      MIN(c.created_at)                                                        AS submitted_at
    FROM public.helper_credentials c
    WHERE c.credential_type IN ('trade_license', 'insurance')
      AND c.status IN ('unverified', 'submitted')
    GROUP BY c.user_id
  )
  SELECT
    p.user_id, p.full_name, p.email, p.avatar_url,
    COALESCE(p.license_url, hc.license_url)     AS license_url,
    COALESCE(p.insurance_url, hc.insurance_url) AS insurance_url,
    CASE WHEN p.license_status = 'pending' OR COALESCE(hc.has_license, false)
         THEN 'pending' ELSE p.license_status END       AS license_status,
    CASE WHEN p.insurance_status = 'pending' OR COALESCE(hc.has_insurance, false)
         THEN 'pending' ELSE p.insurance_status END     AS insurance_status,
    p.is_licensed  OR COALESCE(hc.has_license, false)   AS is_licensed,
    p.is_insured   OR COALESCE(hc.has_insurance, false) AS is_insured,
    p.business_name,
    LEAST(p.updated_at, COALESCE(hc.submitted_at, p.updated_at)) AS submitted_at
  FROM public.profiles p
  LEFT JOIN hc ON hc.user_id = p.user_id
  WHERE has_role(auth.uid(), 'admin')
    AND (p.license_status = 'pending' OR p.insurance_status = 'pending' OR hc.user_id IS NOT NULL)
  ORDER BY submitted_at ASC;
$function$;
GRANT EXECUTE ON FUNCTION public.get_pending_credentials() TO authenticated;

INSERT INTO auth.users(id) VALUES ('${ADMIN}'), ('${H1}'), ('${H2}'), ('${H3}'), ('${H4}');
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');
INSERT INTO public.profiles(user_id, full_name) VALUES ('${ADMIN}','Admin'), ('${H1}','H1'), ('${H2}','H2'), ('${H4}','H4');
INSERT INTO public.profiles(user_id, full_name, license_status, license_url) VALUES ('${H3}','H3','pending', NULL);
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

async function as(sub, fn) {
  await db.exec(`SET ROLE ${sub ? "authenticated" : "anon"}`);
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [sub ?? ""]);
  try {
    return await fn();
  } finally {
    await db.exec(`RESET ROLE`);
    await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
}
async function attempt(sub, sql, params = []) {
  try {
    const r = await as(sub, () => db.query(sql, params));
    return { ok: true, rows: r.rows };
  } catch (e) {
    return { ok: false, code: e.code, msg: e.message };
  }
}

// 1. Member submits with a document (CredentialsTab-era / harness / prod-seed shape).
const withDoc = await attempt(H1,
  `INSERT INTO public.helper_credentials(user_id, credential_type, trade_category, license_number, license_state, document_url)
   VALUES ($1, 'trade_license', 'handyman', 'X', 'LA', 'u/1/license.png') RETURNING id, status`, [H1]);
check("member INSERT of a trade_license WITH a document succeeds as 'submitted'",
  withDoc.ok && withDoc.rows[0]?.status === "submitted", withDoc.msg ?? JSON.stringify(withDoc.rows));

// 2. Member submits without one -> refused.
for (const [label, doc] of [["NULL", null], ["blank", "   "]]) {
  for (const type of ["trade_license", "insurance"]) {
    const r = await attempt(H2,
      `INSERT INTO public.helper_credentials(user_id, credential_type, document_url) VALUES ($1, $2, $3)`, [H2, type, doc]);
    check(`member INSERT of a ${type} with a ${label} document is refused (23514)`,
      !r.ok && r.code === "23514", r.ok ? "INSERTED" : `${r.code} ${r.msg}`);
  }
}

// 3. Server paths that are legitimately document-less still work.
let serverOk = true;
let serverMsg = "";
try {
  await db.query(`INSERT INTO public.helper_credentials(user_id, credential_type, status) VALUES ($1, 'background_check', 'submitted')`, [H4]);
  await db.query(`INSERT INTO public.helper_credentials(user_id, credential_type, status) VALUES ($1, 'insurance', 'expired')`, [H4]);
  await db.query(`INSERT INTO public.helper_credentials(user_id, credential_type, status, rejection_reason) VALUES ($1, 'bond', 'rejected', 'x')`, [H4]);
  await db.query(`INSERT INTO public.helper_credentials(user_id, credential_type, status) VALUES ($1, 'trade_license', 'rejected')`, [H4]);
} catch (e) {
  serverOk = false;
  serverMsg = e.message;
}
check("server INSERTs of a document-less background_check 'submitted' and expired/rejected rows still work", serverOk, serverMsg);

// 4. Clearing the document of a pending row is refused.
const clear = await attempt(H1,
  `UPDATE public.helper_credentials SET document_url = NULL WHERE user_id = $1 AND credential_type = 'trade_license' RETURNING id`, [H1]);
check("member UPDATE clearing a pending row's document is refused (23514)",
  !clear.ok && clear.code === "23514", clear.ok ? `updated ${clear.rows.length}` : `${clear.code} ${clear.msg}`);

// 5. The table owner (no RLS, no member trigger branch) is refused too.
let forced = false;
try {
  await db.query(`INSERT INTO public.helper_credentials(user_id, credential_type, status) VALUES ($1, 'insurance', 'submitted')`, [H2]);
  forced = true;
} catch {
  /* refused by the CHECK: the reader half is then proven by H3 below */
}
if (MODE !== "skip") check("even the table owner cannot write a document-less pending insurance row", !forced);

// 6. Queue: every row returned has an actionable credential; H1 listed, H2/H3/H4 not.
const q = await attempt(ADMIN, `SELECT * FROM public.get_pending_credentials()`);
const rows = q.ok ? q.rows : [];
const actionable = (r) =>
  (r.license_status === "pending" && !!r.license_url) || (r.insurance_status === "pending" && !!r.insurance_url);
check("queue reads as admin", q.ok, q.msg ?? "");
check("every queue row has an Approve/Reject box (pending AND a document)",
  rows.length > 0 && rows.every(actionable),
  rows.filter((r) => !actionable(r)).map((r) => r.full_name).join(",") || `${rows.length} rows`);
check("H1 (document) is listed", rows.some((r) => r.user_id === H1));
check("H3 (profiles 'pending', no URL) is NOT listed", !rows.some((r) => r.user_id === H3));
check("H2 (no document) is NOT listed", !rows.some((r) => r.user_id === H2));
check("H4 (background check / expired / rejected only) is NOT listed", !rows.some((r) => r.user_id === H4));
const nonAdmin = await attempt(H1, `SELECT * FROM public.get_pending_credentials()`);
check("a non-admin gets no rows", nonAdmin.ok && nonAdmin.rows.length === 0, nonAdmin.msg ?? `${nonAdmin.rows?.length}`);

if (MODE !== "skip") {
  const acl = await db.query(`SELECT proacl::text AS a FROM pg_proc WHERE proname = 'get_pending_credentials'`);
  const a = acl.rows[0]?.a ?? "";
  check("get_pending_credentials: no PUBLIC or anon EXECUTE", !/(^|[{,])=X/.test(a) && !/anon=X/.test(a), a);
  const con = await db.query(`SELECT convalidated FROM pg_constraint WHERE conname = 'helper_credentials_pending_review_needs_document'`);
  check("constraint exists and is VALIDATED", con.rows.length === 1 && con.rows[0].convalidated === true);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
