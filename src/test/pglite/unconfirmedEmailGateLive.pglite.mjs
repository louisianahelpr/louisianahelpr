#!/usr/bin/env node
/**
 * PGlite proof for scripts/ci/unconfirmed-email-gate.sql (Q838): the live
 * detector that every public table keeps an ENABLED Q807 email gate.
 *
 *   node src/test/pglite/unconfirmedEmailGateLive.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/unconfirmedEmailGateLive.pglite.mjs   # RED: no gate at all
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). The fixture
 * is the Q807 proof's (src/test/pglite/unconfirmedEmailWritesRefused.pglite.mjs):
 * auth.users, two client tables and the two anon-writable telemetry tables,
 * then 20260927234313 applied 3x (it attaches the gate to every public table
 * but analytics_events / error_logs). The detector must:
 *   - read clean on that state (telemetry tables exempt, not flagged);
 *   - flag a table created later without attach_unconfirmed_email_gate();
 *   - flag a gate disabled outside a migration (tgenabled 'D'), and a
 *     replica-only one ('R' never fires in normal operation);
 *   - flag a gate re-created on INSERT only, or pointed at another function;
 *   - read clean again once each is put back (ENABLE ALWAYS counts as on).
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8");
const Q807 = read("../../../supabase/migrations/20260927234313_refuse_unconfirmed_email_writes.sql");
const CHECK = read("../../../scripts/ci/unconfirmed-email-gate.sql").replace(/;\s*$/, "");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: Q807 not applied, no table has a gate (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role', true), '') $$;
GRANT USAGE ON SCHEMA auth, public, storage TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE public.jobs (id serial PRIMARY KEY, title text);
CREATE TABLE public.messages (id serial PRIMARY KEY, content text);
CREATE TABLE public.error_logs (id serial PRIMARY KEY, message text);
CREATE TABLE public.analytics_events (id serial PRIMARY KEY, name text);
CREATE TABLE storage.objects (id serial PRIMARY KEY, bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
`);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(Q807);

const offenders = async () => (await db.query(CHECK)).rows.map((r) => `${r.table}: ${r.what}`);
const expect = async (label, want) => {
  const got = await offenders();
  check(label, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
};

await expect("C1 Q807's state reads clean (telemetry tables exempt)", []);

await db.exec("CREATE TABLE public.zz_made_in_the_dashboard (id int);");
await expect("R1 a table created without attach_unconfirmed_email_gate() is flagged", ["zz_made_in_the_dashboard: no email gate trigger"]);
if (MODE === "skip") {
  // Without Q807 there is no attach function to put the gates back with; the
  // red above (every client table flagged) is the whole point of this mode.
  console.log(`${failures} FAILED`);
  process.exit(1);
}
await db.exec("SELECT public.attach_unconfirmed_email_gate();");
await expect("L1 ...and reads clean once the gate is attached", []);

await db.exec("ALTER TABLE public.jobs DISABLE TRIGGER zz_refuse_unconfirmed_email_write;");
await expect("R2 a gate disabled outside a migration is flagged", ["jobs: email gate trigger not enabled (tgenabled D)"]);
await db.exec("ALTER TABLE public.jobs ENABLE REPLICA TRIGGER zz_refuse_unconfirmed_email_write;");
await expect("R3 a replica-only gate (never fires in normal operation) is flagged", ["jobs: email gate trigger not enabled (tgenabled R)"]);
await db.exec("ALTER TABLE public.jobs ENABLE ALWAYS TRIGGER zz_refuse_unconfirmed_email_write;");
await expect("L2 ENABLE ALWAYS counts as on", []);

await db.exec(`DROP TRIGGER zz_refuse_unconfirmed_email_write ON public.messages;
  CREATE TRIGGER zz_refuse_unconfirmed_email_write BEFORE INSERT ON public.messages
  FOR EACH STATEMENT EXECUTE FUNCTION public.refuse_unconfirmed_email_write();`);
await expect("R4 a gate re-created on INSERT only is flagged", ["messages: email gate trigger misses INSERT, UPDATE or DELETE"]);
await db.exec(`CREATE FUNCTION public.zz_noop() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
  DROP TRIGGER zz_refuse_unconfirmed_email_write ON public.messages;
  CREATE TRIGGER zz_refuse_unconfirmed_email_write BEFORE INSERT OR UPDATE OR DELETE ON public.messages
  FOR EACH STATEMENT EXECUTE FUNCTION public.zz_noop();`);
await expect("R5 a gate pointed at another function is flagged", ["messages: email gate trigger runs another function"]);
await db.exec("DROP TRIGGER zz_refuse_unconfirmed_email_write ON public.messages; SELECT public.attach_unconfirmed_email_gate();");
await expect("L3 re-attached: clean", []);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
