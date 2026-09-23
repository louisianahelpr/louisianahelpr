#!/usr/bin/env node
/**
 * PGlite proof for 20260923113829_helper_credential_document_is_own (docs/OPEN.md Q130).
 *
 *   node src/test/pglite/helperCredentialDocumentIsOwn.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/helperCredentialDocumentIsOwn.pglite.mjs   # RED: live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = the LIVE prod state (read 2026-09-23):
 *   - public.helper_credentials: live columns, the three live CHECKs, RLS on
 *     with the three live policies (UPDATE with no WITH CHECK), the live
 *     column grants to authenticated;
 *   - trg_credential_status_server_owned with the live body of
 *     enforce_credential_status_server_owned (pg_get_functiondef);
 *   - storage.objects + the live user-documents policies and
 *     is_submitted_credential_object, built by applying migration
 *     20260923110759 (Q127) verbatim — it is what prod runs (verified live).
 * The new migration is applied 3x (replay-safe), then every legitimate
 * writer's write is shown to still work and every bad one refused.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const Q127 = mig("20260923110759_credential_url_is_own_document.sql");
const NEW = mig("20260923113829_helper_credential_document_is_own.sql");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ADMIN = "aaaaaaaa-0000-0000-0000-00000000000a";
const M = (n) => `11111111-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;

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
INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin');

-- profiles: only what Q127's migration and is_submitted_credential_object read.
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, business_name text, license_url text, insurance_url text,
  license_status text DEFAULT 'none', insurance_status text DEFAULT 'none', is_licensed boolean DEFAULT false, is_insured boolean DEFAULT false,
  license_reviewed_at timestamptz, insurance_reviewed_at timestamptz, license_reviewed_by uuid, insurance_reviewed_by uuid,
  license_rejection_reason text, insurance_rejection_reason text);

-- storage (live foldername), policies come from Q127 below.
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
CREATE POLICY "Owner upload user-documents" ON storage.objects FOR INSERT TO public
  WITH CHECK ((bucket_id = 'user-documents'::text) AND ((auth.uid())::text = (storage.foldername(name))[1]));
CREATE POLICY "Users can upload their own documents" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'user-documents'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text));
CREATE POLICY "user-documents: owner or admin read" ON storage.objects FOR SELECT TO authenticated
  USING ((bucket_id = 'user-documents'::text) AND (((auth.uid())::text = (storage.foldername(name))[1]) OR has_role(auth.uid(), 'admin'::app_role)));

-- Live helper_credentials (information_schema.columns / pg_constraint / pg_policies / column_privileges, 2026-09-23).
CREATE TABLE public.helper_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  credential_type text NOT NULL CHECK (credential_type = ANY (ARRAY['identity','background_check','trade_license','insurance','bond'])),
  status text NOT NULL DEFAULT 'unverified' CHECK (status = ANY (ARRAY['unverified','submitted','verified','expired','rejected'])),
  license_number text, license_state text DEFAULT 'LA', trade_category text, issuing_authority text,
  document_url text, expiration_date date, verified_at timestamptz, rejection_reason text, vendor_check_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT helper_credentials_pending_review_needs_document CHECK (
    (credential_type <> ALL (ARRAY['trade_license','insurance'])) OR (status <> ALL (ARRAY['unverified','submitted']))
    OR (NULLIF(btrim(document_url), ''::text) IS NOT NULL))
);
ALTER TABLE public.helper_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can insert own credentials" ON public.helper_credentials FOR INSERT TO public WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can update own credentials" ON public.helper_credentials FOR UPDATE TO public USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "Users can view own credentials" ON public.helper_credentials FOR SELECT TO public USING ((SELECT auth.uid()) = user_id);
GRANT SELECT ON public.helper_credentials TO anon, authenticated;
GRANT INSERT (created_at, credential_type, document_url, expiration_date, id, issuing_authority, license_number, license_state, trade_category, updated_at, user_id) ON public.helper_credentials TO authenticated;
GRANT UPDATE (credential_type, document_url, expiration_date, issuing_authority, license_number, license_state, trade_category, updated_at) ON public.helper_credentials TO authenticated;

-- Live enforce_credential_status_server_owned, verbatim (comments dropped).
CREATE OR REPLACE FUNCTION public.enforce_credential_status_server_owned()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
`);
// Live storage policies + is_submitted_credential_object = Q127's migration.
await db.exec(Q127);

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
const putObject = (name) => q(`INSERT INTO storage.objects (bucket_id, name) VALUES ('user-documents', $1) ON CONFLICT DO NOTHING`, [name]);
const as = async (uid, sql, params = []) => {
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
/** Service role (stripe-webhook, prod-seed): no uid, not anon/authenticated. */
const server = async (sql, params = []) => {
  try {
    return { rows: await q(sql, params), error: null };
  } catch (e) {
    return { rows: [], error: e };
  }
};
const memberInsert = (uid, type, doc) =>
  as(uid, `INSERT INTO public.helper_credentials (user_id, credential_type, document_url) VALUES ($1, $2, $3) RETURNING id, status, document_url`, [uid, type, doc]);
const path = (uid, kind, n = 0, ext = "png") => `${uid}/credentials/${kind}-${1790000000000 + n}.${ext}`;
const byId = async (id) => (await q(`SELECT * FROM public.helper_credentials WHERE id = $1`, [id]))[0];
const count = async (uid) => Number((await q(`SELECT count(*)::int AS n FROM public.helper_credentials WHERE user_id = $1`, [uid]))[0].n);
const err = (r) => (r.error ? `${r.error.code} ${r.error.message.slice(0, 90)}` : `accepted ${JSON.stringify(r.rows[0] ?? {})}`);

// ── Member INSERT: refused values (row count must stay 0) ──
await putObject(path(M(99), "trade_license"));
const refusedInserts = [
  ["U+200B zero-width space", "trade_license", () => "​"],
  ["U+FEFF byte-order mark", "insurance", () => "﻿"],
  ["another member's folder (object exists)", "trade_license", () => path(M(99), "trade_license")],
  ["a data: URL (the seed's shape)", "trade_license", () => "data:image/png;base64,iVBORw0KGgo="],
  ["an https URL", "insurance", () => "https://evil.example/coi.pdf"],
  ["a bare file name", "trade_license", () => "license.pdf"],
  ["right shape, no uploaded object", "trade_license", (u) => path(u, "trade_license", 5)],
  ["insurance path on a trade_license row", "trade_license", (u) => path(u, "insurance")],
  ["own path + trailing ZWSP", "trade_license", (u) => `${path(u, "trade_license")}​`],
  ["own path, disallowed extension", "trade_license", (u) => path(u, "trade_license", 0, "html")],
  ["bond with no document", "bond", () => null],
  ["background_check (vendor-recorded) as a member", "background_check", () => null],
  ["identity (vendor-recorded) as a member", "identity", () => null],
];
let n = 10;
for (const [label, type, make] of refusedInserts) {
  const uid = M(n++);
  const v = make(uid);
  // Upload whatever own-folder object the value names, so only the rule under test can refuse it.
  if (v && v.startsWith(`${uid}/`) && !label.includes("no uploaded object")) await putObject(v.replace(/​$/, ""));
  if (v && v.startsWith(`${uid}/`) && label.includes("disallowed")) await putObject(v);
  const r = await memberInsert(uid, type, v);
  check(`member INSERT ${label} -> refused, nothing written`, !!r.error && (await count(uid)) === 0, err(r));
}

// ── Member INSERT: the legitimate shapes ──
const LIC = M(40);
const licPath = path(LIC, "trade_license");
await putObject(licPath);
const lic = await memberInsert(LIC, "trade_license", licPath);
check("member INSERT trade_license, own uploaded path -> submitted", !lic.error && lic.rows[0]?.status === "submitted" && lic.rows[0]?.document_url === licPath, err(lic));
{
  const uid = M(41);
  const p = path(uid, "bond", 0, "PDF");
  await putObject(p);
  const r = await memberInsert(uid, "bond", p);
  check("member INSERT bond, own uploaded path (.PDF, older client) -> submitted", !r.error && r.rows[0]?.status === "submitted", err(r));
}
{
  const uid = M(42);
  const p = path(uid, "insurance", 0, "heic");
  await putObject(p);
  const r = await memberInsert(uid, "insurance", p);
  check("member INSERT insurance, own uploaded .heic -> submitted", !r.error && r.rows[0]?.status === "submitted", err(r));
}

// ── Member UPDATE on a submitted row: document / type swap refused, the rest untouched ──
const licId = lic.rows[0]?.id;
{
  const other = path(LIC, "trade_license", 1);
  await putObject(other);
  const r = await as(LIC, `UPDATE public.helper_credentials SET document_url = $2 WHERE id = $1 RETURNING document_url`, [licId, other]);
  const row = await byId(licId);
  check("member swaps document_url on a submitted row (new object uploaded) -> refused, unchanged", !!r.error && row.document_url === licPath && row.status === "submitted", `${err(r)} now=${row.document_url}`);
  const z = await as(LIC, `UPDATE public.helper_credentials SET document_url = $2 WHERE id = $1 RETURNING document_url`, [licId, "​"]);
  check("member sets document_url = U+200B on a submitted row -> refused", !!z.error && (await byId(licId)).document_url === licPath, err(z));
  const t = await as(LIC, `UPDATE public.helper_credentials SET credential_type = 'insurance' WHERE id = $1 RETURNING credential_type`, [licId]);
  check("member changes credential_type on a submitted row -> refused", !!t.error && (await byId(licId)).credential_type === "trade_license", err(t));
  const ok = await as(LIC, `UPDATE public.helper_credentials SET license_number = 'LA-1', expiration_date = '2027-01-01' WHERE id = $1 RETURNING license_number`, [licId]);
  check("member edits license_number / expiry on a submitted row -> still allowed", !ok.error && ok.rows[0]?.license_number === "LA-1", err(ok));
  const same = await as(LIC, `UPDATE public.helper_credentials SET document_url = $2, trade_category = 'handyman' WHERE id = $1 RETURNING id`, [licId, licPath]);
  check("member PATCH re-sending the SAME document_url is refused by grant or passes unchanged, row intact",
    (await byId(licId)).document_url === licPath, err(same));
}
{
  // Should the column grant ever come back, the trigger still refuses the swap.
  await db.exec(`GRANT UPDATE (document_url, credential_type) ON public.helper_credentials TO authenticated`);
  const other = path(LIC, "trade_license", 2);
  await putObject(other);
  const r = await as(LIC, `UPDATE public.helper_credentials SET document_url = $2 WHERE id = $1 RETURNING document_url`, [licId, other]);
  check("with the column grant restored, the trigger still refuses the swap", !!r.error && (await byId(licId)).document_url === licPath, err(r));
  if (MODE !== "skip") await db.exec(`REVOKE UPDATE (document_url, credential_type) ON public.helper_credentials FROM authenticated`);
}
{
  // Another member cannot touch the row at all (RLS USING), nor move a row into their name.
  const r = await as(M(43), `UPDATE public.helper_credentials SET license_number = 'x' WHERE id = $1 RETURNING id`, [licId]);
  check("another member's UPDATE matches 0 rows", !r.error && r.rows.length === 0, err(r));
}

// ── Existing rows: the seed's data: URL row survives an unrelated UPDATE ──
{
  const SEED = M(50);
  // Plant the legacy value the way it exists on prod (written before this migration): bypass triggers.
  await db.exec(`ALTER TABLE public.helper_credentials DISABLE TRIGGER USER`);
  const rows = await q(`INSERT INTO public.helper_credentials (user_id, credential_type, status, document_url) VALUES ($1, 'trade_license', 'submitted', 'data:image/png;base64,iVBORw0KGgo=') RETURNING id`, [SEED]);
  await db.exec(`ALTER TABLE public.helper_credentials ENABLE TRIGGER USER`);
  const m = await as(SEED, `UPDATE public.helper_credentials SET license_number = 'SEED-1' WHERE id = $1 RETURNING id`, [rows[0].id]);
  check("legacy data: URL row: member's unrelated UPDATE still works", !m.error && m.rows.length === 1, err(m));
  const a = await server(`UPDATE public.helper_credentials SET status = 'rejected', rejection_reason = 'r' WHERE id = $1 RETURNING status`, [rows[0].id]);
  check("legacy data: URL row: server/admin status decision still works", !a.error && a.rows[0]?.status === "rejected", err(a));
  const p = path(SEED, "trade_license");
  await putObject(p);
  const s = await server(`UPDATE public.helper_credentials SET document_url = $2, status = 'submitted' WHERE id = $1 RETURNING document_url`, [rows[0].id, p]);
  check("service role re-points the seed row at an uploaded object -> ok", !s.error && s.rows[0]?.document_url === p, err(s));
  const bad = await server(`UPDATE public.helper_credentials SET document_url = 'data:image/png;base64,AAAA' WHERE id = $1`, [rows[0].id]);
  check("service role writing a data: URL -> refused (applies to every writer)", !!bad.error, err(bad));
}

// ── Server writers ──
{
  const uid = M(51);
  const r = await server(`INSERT INTO public.helper_credentials (user_id, credential_type, status) VALUES ($1, 'background_check', 'submitted') RETURNING id`, [uid]);
  check("stripe-webhook INSERT background_check, submitted, no document -> ok", !r.error && r.rows.length === 1, err(r));
  const withDoc = await server(`INSERT INTO public.helper_credentials (user_id, credential_type, status, document_url) VALUES ($1, 'background_check', 'submitted', 'x/credentials/y.pdf')`, [uid]);
  check("service role background_check WITH a document -> refused", !!withDoc.error, err(withDoc));
  const v = await server(`UPDATE public.helper_credentials SET status = 'verified', verified_at = now() WHERE id = $1 RETURNING status`, [r.rows[0]?.id]);
  check("sync_credential_from_check-style status update -> ok", !v.error && v.rows[0]?.status === "verified", err(v));
  const ident = await server(`INSERT INTO public.helper_credentials (user_id, credential_type, status) VALUES ($1, 'identity', 'verified') RETURNING id`, [uid]);
  check("service role identity row, no document -> ok", !ident.error, err(ident));
}
{
  // Admin review decision (review_credential mirrors onto helper_credentials).
  await q(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [ADMIN]);
  let r;
  try {
    r = { rows: await q(`UPDATE public.helper_credentials SET status = 'verified', verified_at = now() WHERE id = $1 RETURNING status`, [licId]), error: null };
  } catch (e) {
    r = { rows: [], error: e };
  }
  await q(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  check("admin approves the submitted row -> ok", !r.error && r.rows[0]?.status === "verified", err(r));
  const noop = await as(LIC, `UPDATE public.helper_credentials SET license_number = 'changed' WHERE id = $1 RETURNING license_number`, [licId]);
  check("member edit of a VERIFIED row is still a silent no-op", !noop.error && (await byId(licId)).license_number === "LA-1", err(noop));
}

// ── Storage: the object a submitted helper_credentials row names is frozen ──
{
  const uid = M(60);
  const p = path(uid, "insurance");
  const other = `${uid}/portfolio/photo.jpg`;
  await putObject(p);
  await putObject(other);
  const ins = await memberInsert(uid, "insurance", p);
  check("(setup) member submits insurance", !ins.error, err(ins));
  const upd = await as(uid, `UPDATE storage.objects SET metadata = '{"swapped":true}' WHERE bucket_id='user-documents' AND name = $1 RETURNING id`, [p]);
  check("member cannot overwrite (upsert) the submitted document", upd.rows.length === 0, `rows=${upd.rows.length}`);
  const del = await as(uid, `DELETE FROM storage.objects WHERE bucket_id='user-documents' AND name = $1 RETURNING id`, [p]);
  check("member cannot delete (then re-upload) the submitted document", del.rows.length === 0, `rows=${del.rows.length}`);
  const delOther = await as(uid, `DELETE FROM storage.objects WHERE bucket_id='user-documents' AND name = $1 RETURNING id`, [other]);
  check("member can still delete another own object", delOther.rows.length === 1, `rows=${delOther.rows.length}`);
}

// ── Shape ──
{
  const pol = (await q(`SELECT with_check FROM pg_policies WHERE tablename = 'helper_credentials' AND policyname = 'Users can update own credentials'`))[0];
  check("UPDATE policy has a WITH CHECK", !!pol?.with_check, String(pol?.with_check));
  const grants = (await q(`SELECT column_name FROM information_schema.column_privileges WHERE table_name = 'helper_credentials' AND grantee = 'authenticated' AND privilege_type = 'UPDATE' ORDER BY 1`)).map((r) => r.column_name);
  check("authenticated has no UPDATE on document_url / credential_type", !grants.includes("document_url") && !grants.includes("credential_type") && grants.length > 3, grants.join(","));
  const fns = await q(`SELECT proname, prosecdef, proconfig, coalesce(proacl::text, '') AS acl FROM pg_proc
                        WHERE proname IN ('helper_credential_document_ok','enforce_helper_credential_document')`);
  for (const name of ["helper_credential_document_ok", "enforce_helper_credential_document"]) {
    const f = fns.find((x) => x.proname === name);
    check(`${name}: SECURITY DEFINER, search_path=public, no client EXECUTE`,
      !!f && f.prosecdef && (f.proconfig ?? []).includes("search_path=public") && !/(^|[{,])=X|anon=|authenticated=/.test(f.acl), f?.acl ?? "missing");
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
