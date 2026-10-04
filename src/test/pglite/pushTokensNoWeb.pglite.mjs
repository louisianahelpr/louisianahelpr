#!/usr/bin/env node
/**
 * PGlite proof for 20261004191820_push_tokens_no_web (docs/OPEN.md Q1252).
 *
 *   node src/test/pglite/pushTokensNoWeb.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/pushTokensNoWeb.pglite.mjs # RED: the live state
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture = public.push_tokens as LIVE on 2026-10-04 for what matters here:
 * the platform CHECK (ios, android, web), UNIQUE (user_id, token), RLS on,
 * authenticated's table-level INSERT (relacl arwdxm) and an own-row INSERT
 * policy (the app upserts its own token, nativePush.ts). A second database
 * holding a stray 'web' row proves the migration replays without failing.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const NEW = readFileSync(new URL("../../../supabase/migrations/20261004191820_push_tokens_no_web.sql", import.meta.url).pathname, "utf8");
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the LIVE (unfixed) state (expect FAILs)`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const USER = "437de07d-1bd7-46c8-a451-6b46aa3bcad5";
const SETUP = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TABLE public.push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  token text NOT NULL,
  platform text NOT NULL CONSTRAINT push_tokens_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text, 'web'::text]))),
  device_id text, app_version text,
  CONSTRAINT push_tokens_user_id_token_key UNIQUE (user_id, token)
);
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_tokens TO authenticated;
GRANT ALL ON public.push_tokens TO service_role;
CREATE POLICY own ON public.push_tokens FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
`;

const db = new PGlite();
await db.exec(SETUP);
if (MODE !== "skip") for (let i = 0; i < 3; i++) await db.exec(NEW);

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who}', false); SET ROLE authenticated;`);
  try { const r = await db.query(sql); return { ok: true, rows: r.rows }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const ins = (platform, token) => as(USER, `INSERT INTO public.push_tokens (user_id, token, platform, device_id) VALUES ('${USER}', '${token}', '${platform}', '${platform}-x') RETURNING id`);

const web = await ins("web", "web-token-1");
check("R1 a 'web' registration (nothing can deliver to it) is refused", !web.ok && /push_tokens_platform_check/.test(web.err), web.ok ? "landed" : web.err);
const ios = await ins("ios", "apns-token-1");
check("L1 the app's iOS registration still lands", ios.ok && ios.rows.length === 1, ios.ok ? "" : ios.err);
const android = await ins("android", "fcm-token-1");
check("L2 an 'android' registration is still accepted (counted and skipped by the sender, Q1126)", android.ok, android.ok ? "" : android.err);
const v = (await db.query(`SELECT convalidated FROM pg_constraint WHERE conname = 'push_tokens_platform_check'`)).rows[0]?.convalidated;
check("L3 the constraint is validated on a database with no stray row", v === true, String(v));

// Replay onto a database that still holds a 'web' row: reported, not a failed deploy.
if (MODE !== "skip") {
  const db2 = new PGlite();
  await db2.exec(SETUP);
  await db2.exec(`INSERT INTO public.push_tokens (user_id, token, platform) VALUES ('${USER}', 'stray', 'web')`);
  let ok = true, err = "";
  try { for (let i = 0; i < 3; i++) await db2.exec(NEW); } catch (e) { ok = false; err = e.message; }
  const v2 = (await db2.query(`SELECT convalidated FROM pg_constraint WHERE conname = 'push_tokens_platform_check'`)).rows[0]?.convalidated;
  check("L4 a stray 'web' row does not fail the migration (left NOT VALID and reported)", ok && v2 === false, ok ? `convalidated=${v2}` : err);
}

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
