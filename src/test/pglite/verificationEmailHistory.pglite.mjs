#!/usr/bin/env node
/**
 * PGlite proof for 20261023193408_admin_verification_email_history (Q2354).
 *
 *   node src/test/pglite/verificationEmailHistory.pglite.mjs
 *   NEW_MIGRATION=skip node src/test/pglite/verificationEmailHistory.pglite.mjs   # RED without the file
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 * Stubs: roles + prod's default function ACL, profiles (user_id, email,
 * email_verified) and email_send_log (template_name, recipient_email, status,
 * created_at), the columns measured on prod 2026-10-23. Applies the migration
 * 3x and proves the count, the last send, case-insensitive matching, the
 * one-hour next_allowed_at, other templates ignored, and the ACL.
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = readFileSync(new URL("../../../supabase/migrations/20261023193408_admin_verification_email_history.sql", import.meta.url).pathname, "utf8");

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, email text, email_verified boolean);
CREATE TABLE public.email_send_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_name text, recipient_email text, status text, created_at timestamptz NOT NULL DEFAULT now());
`);
if (process.env.NEW_MIGRATION !== "skip") {
  for (let i = 0; i < 3; i++) await db.exec(`BEGIN;\n${MIG}\nCOMMIT;`);
}

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};
const hist = async (u) => {
  try {
    const { rows } = await db.query(`SELECT public.verification_email_history($1::uuid) AS h`, [u]);
    return rows[0].h;
  } catch (e) {
    return { error: String(e.message) };
  }
};

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
await db.exec(`
INSERT INTO public.profiles VALUES ('${A}', 'Lucy@Example.com', false), ('${B}', 'fresh@example.com', false), ('${C}', 'none@example.com', true);
INSERT INTO public.email_send_log (template_name, recipient_email, status, created_at) VALUES
  ('signup', 'lucy@example.com', 'sent', now() - interval '3 days'),
  ('signup', 'lucy@example.com', 'sent', now() - interval '2 days'),
  ('signup', 'lucy@example.com', 'sent', now() - interval '5 hours'),
  ('job_match', 'lucy@example.com', 'sent', now() - interval '1 minute'),
  ('signup', 'fresh@example.com', 'sent', now() - interval '20 minutes');
`);

const a = await hist(A);
check("counts only 'signup' sends, matching the address case-insensitively", a?.sent_count === 3, JSON.stringify(a));
check("names the last send (5 hours ago) and allows the next now", a?.found === true && a?.last_status === "sent" && a?.next_allowed_at === null, JSON.stringify(a));

const b = await hist(B);
const waitMs = b?.next_allowed_at ? new Date(b.next_allowed_at).getTime() - Date.now() : NaN;
check("a send 20 minutes ago holds the next one for ~40 minutes", waitMs > 39 * 60_000 && waitMs <= 40 * 60_000 + 5_000, `${Math.round(waitMs / 60000)} min`);

const c = await hist(C);
check("a member with nothing on record reads 0 and no wait", c?.sent_count === 0 && c?.next_allowed_at === null && c?.email_verified === true, JSON.stringify(c));
const none = await hist("00000000-0000-0000-0000-0000000000ff");
check("an unknown member reads found=false", none?.found === false, JSON.stringify(none));

const { rows: acl } = await db.query(
  `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u, has_function_privilege('service_role', p.oid, 'EXECUTE') s
     FROM pg_proc p WHERE p.proname = 'verification_email_history'`,
);
check("service_role only (anon/authenticated cannot EXECUTE)", acl.length === 1 && !acl[0].a && !acl[0].u && acl[0].s, JSON.stringify(acl));

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
