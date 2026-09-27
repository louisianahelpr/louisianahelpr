#!/usr/bin/env node
/**
 * PGlite proof for 20260927234313_refuse_unconfirmed_email_writes (docs/OPEN.md
 * Q807): a session whose auth.users row has no email_confirmed_at cannot write
 * any public table (direct or through a SECURITY DEFINER RPC) or storage;
 * confirmed users, server contexts and the two anon-writable telemetry tables
 * are untouched.
 *
 *   node src/test/pglite/unconfirmedEmailWritesRefused.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/unconfirmedEmailWritesRefused.pglite.mjs   # RED
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). auth.uid() and
 * auth.role() read GUCs, the way Supabase's read request.jwt.claims. The
 * migration is applied 3x (replay safety), then a table created AFTER it gets
 * the gate by calling attach_unconfirmed_email_gate(), as later migrations must.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const Q807 = "20260927234313_refuse_unconfirmed_email_writes.sql";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const CONFIRMED = "00000000-0000-0000-0000-00000000000c";
const UNCONFIRMED = "00000000-0000-0000-0000-00000000000e";
const GONE = "00000000-0000-0000-0000-00000000000d";

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
INSERT INTO auth.users VALUES
  ('${CONFIRMED}', 'c@example.com', now()),
  ('${UNCONFIRMED}', 'u@example.com', NULL);
CREATE TABLE public.jobs (id serial PRIMARY KEY, title text);
CREATE TABLE public.error_logs (id serial PRIMARY KEY, message text);
CREATE TABLE public.analytics_events (id serial PRIMARY KEY, name text);
GRANT ALL ON public.jobs, public.error_logs, public.analytics_events TO authenticated, anon, service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated, anon, service_role;
CREATE FUNCTION public.post_job_rpc(t text) RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.jobs (title) VALUES (t) RETURNING id $$;
GRANT EXECUTE ON FUNCTION public.post_job_rpc(text) TO authenticated;
CREATE TABLE storage.objects (id serial PRIMARY KEY, bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY open_all ON storage.objects FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON storage.objects TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA storage TO authenticated;
INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', 'seed');
INSERT INTO public.jobs (title) VALUES ('seed');
`);

if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(mig(Q807));
}

/** Run sql as a session: uid + jwt role, and the matching database role. */
const as = async (uid, role, sql) => {
  await db.exec(`RESET ROLE; SELECT set_config('test.uid', '${uid ?? ""}', false); SELECT set_config('test.role', '${role ?? ""}', false);`);
  if (role === "authenticated" || role === "anon" || role === "service_role") await db.exec(`SET ROLE ${role}`);
  try {
    await db.exec(sql);
    return { ok: true };
  } catch (e) {
    return { ok: false, err: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE`);
  }
};
const refused = (r) => !r.ok && /email_unconfirmed/.test(r.err);

// Unconfirmed session: every write path refused.
check("unconfirmed INSERT refused", refused(await as(UNCONFIRMED, "authenticated", `INSERT INTO public.jobs (title) VALUES ('x')`)));
check("unconfirmed UPDATE refused", refused(await as(UNCONFIRMED, "authenticated", `UPDATE public.jobs SET title='y'`)));
check("unconfirmed DELETE refused", refused(await as(UNCONFIRMED, "authenticated", `DELETE FROM public.jobs`)));
check("unconfirmed SECURITY DEFINER RPC refused", refused(await as(UNCONFIRMED, "authenticated", `SELECT public.post_job_rpc('rpc')`)));
check("deleted user's live token refused", refused(await as(GONE, "authenticated", `INSERT INTO public.jobs (title) VALUES ('x')`)));
const up = await as(UNCONFIRMED, "authenticated", `INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', 'u.png')`);
check("unconfirmed storage upload refused", !up.ok && /row-level security/.test(up.err), up.err ?? "");
const sdel = await as(UNCONFIRMED, "authenticated", `DELETE FROM storage.objects`);
const left = (await db.query(`SELECT count(*)::int n FROM storage.objects`)).rows[0].n;
check("unconfirmed storage delete removes nothing", sdel.ok && left === 1, `rows left ${left}`);

// Everyone else unaffected.
check("confirmed INSERT allowed", (await as(CONFIRMED, "authenticated", `INSERT INTO public.jobs (title) VALUES ('c')`)).ok);
check("confirmed RPC allowed", (await as(CONFIRMED, "authenticated", `SELECT public.post_job_rpc('c')`)).ok);
check("confirmed storage upload allowed", (await as(CONFIRMED, "authenticated", `INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', 'c.png')`)).ok);
check("service_role (no uid) allowed", (await as(null, "service_role", `INSERT INTO public.jobs (title) VALUES ('s')`)).ok);
check("server context (postgres, no claims) allowed", (await as(null, null, `UPDATE public.jobs SET title = title`)).ok);
check("unconfirmed error_logs allowed (anon-writable)", (await as(UNCONFIRMED, "authenticated", `INSERT INTO public.error_logs (message) VALUES ('e')`)).ok);
check("unconfirmed analytics_events allowed (anon-writable)", (await as(UNCONFIRMED, "authenticated", `INSERT INTO public.analytics_events (name) VALUES ('e')`)).ok);

// A table created later is gated once a migration calls the attach helper.
let attached = false;
try {
  await db.exec(`CREATE TABLE public.later_table (id serial PRIMARY KEY, v text); GRANT ALL ON public.later_table TO authenticated; GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated; SELECT public.attach_unconfirmed_email_gate();`);
  attached = true;
} catch (e) {
  check("attach helper exists", false, String(e.message ?? e));
}
if (attached) check("table created later is gated after attach", refused(await as(UNCONFIRMED, "authenticated", `INSERT INTO public.later_table (v) VALUES ('x')`)));

const trig = (await db.query(`SELECT count(*)::int n FROM pg_trigger WHERE tgname='zz_refuse_unconfirmed_email_write'`)).rows[0].n;
check("exactly one gate per non-exempt table (3x replay made no duplicates)", trig === (attached ? 2 : 1), `triggers ${trig}`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
