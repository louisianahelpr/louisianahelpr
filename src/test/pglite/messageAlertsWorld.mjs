/**
 * Shared PGlite world for the Messages audit E3 (10-30) proofs:
 * messageAlertThrottleMute.pglite.mjs and the ones after it.
 *
 * Models only what the proofs touch: public.messages (prod's columns), the
 * notification tables, thread_mutes, error_logs, a recording net.http_post and a
 * vault.decrypted_secrets table. Functions under test are read VERBATIM from the
 * migrations (newest definition before the file named) and pinned by
 * md5(prosrc) to prod's value, so the "before" state is prod's code or the proof
 * refuses to run.
 *
 * pglite is not a dependency (CLAUDE.md): PGLITE_DIR (default ~/.lh-pglite).
 */
import os from "node:os";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
export const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);

const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
export const readMigration = (f) => readFileSync(MIG_DIR + f, "utf8");

/**
 * The newest `CREATE [OR REPLACE] FUNCTION public.<name>(` statement in the
 * migrations before `before`, cut at its own closing dollar tag (any tag). A
 * match on a `--` comment line is skipped; the md5 pin catches a wrong pick.
 */
export function liveFunctionSql(name, before) {
  let found = null;
  const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`, "gi");
  for (const f of FILES) {
    if (f >= before) break;
    const sql = readMigration(f);
    for (const m of sql.matchAll(head)) {
      const lineStart = sql.lastIndexOf("\n", m.index) + 1;
      if (sql.slice(lineStart, m.index).includes("--")) continue;
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$[A-Za-z_0-9]*\$)/i.exec(rest);
      if (!tag) continue;
      const close = rest.indexOf(tag[1], tag.index + tag[0].length);
      if (close < 0) continue;
      found = { file: f, sql: `${rest.slice(0, close + tag[1].length)};` };
    }
  }
  if (!found) throw new Error(`no migration before ${before} defines public.${name}`);
  return found;
}

export const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const SCHEMA = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE SCHEMA net;
CREATE TABLE net.calls (id bigserial PRIMARY KEY, url text, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}'::jsonb, body jsonb DEFAULT '{}'::jsonb) RETURNS bigint
  LANGUAGE sql AS $$ INSERT INTO net.calls (url, body) VALUES (url, body) RETURNING id $$;
CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES ('supabase_url', 'https://x.supabase.co'), ('service_role_key', 'srk');

CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, full_name text, is_seed boolean NOT NULL DEFAULT false);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, helper_id uuid, status text, title text);
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, sender_id uuid, receiver_id uuid,
  content text NOT NULL DEFAULT '', read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  flagged_hidden boolean NOT NULL DEFAULT false, flag_reason text, attachment_url text, attachment_mime text,
  attachment_size integer, attachment_duration integer, is_system boolean NOT NULL DEFAULT false, reply_to_id uuid,
  read_at timestamptz, edited_at timestamptz, client_id uuid, team_thread_user_id uuid);
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, title text NOT NULL,
  message text NOT NULL DEFAULT '', type text NOT NULL, link text, job_id uuid, read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE,
  messages boolean NOT NULL DEFAULT true, email_messages boolean NOT NULL DEFAULT false,
  push_enabled boolean NOT NULL DEFAULT true, email_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.thread_mutes (
  user_id uuid NOT NULL, job_id uuid NOT NULL, other_user_id uuid NOT NULL,
  muted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, job_id, other_user_id));
CREATE TABLE public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text DEFAULT 'error', message text,
  tags jsonb NOT NULL DEFAULT '{}'::jsonb, context jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now());
`;

export function makeCheck() {
  const state = { failures: 0 };
  const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
    if (!ok) state.failures++;
  };
  return { check, state };
}

/** Load `name` as prod has it (newest definition before `before`), pinned to prod's md5(prosrc). */
export async function loadLive(db, name, before, md5) {
  const { file, sql } = liveFunctionSql(name, before);
  await db.exec(sql);
  const r = await db.query(`SELECT md5(prosrc) AS m FROM pg_proc WHERE proname = $1 AND pronamespace = 'public'::regnamespace`, [name]);
  const got = r.rows[0]?.m;
  if (got !== md5) throw new Error(`fixture is not prod: ${name} from ${file} md5 ${got}, prod ${md5}`);
  return file;
}
