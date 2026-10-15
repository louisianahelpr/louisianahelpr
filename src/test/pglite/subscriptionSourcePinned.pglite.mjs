#!/usr/bin/env node
/**
 * PGlite proof for 20261015005850_pin_subscription_source_self_write: a
 * member cannot move profiles.subscription_source on their own row.
 *
 *   npx tsx src/test/pglite/subscriptionSourcePinned.pglite.mjs                    # GREEN, migration applied 3x
 *   NEW_MIGRATION=skip npx tsx src/test/pglite/subscriptionSourcePinned.pglite.mjs # RED: the state before it
 *
 * pglite is not a dependency (CLAUDE.md): it is loaded from ~/.lh-pglite
 * (override with PGLITE_DIR).
 *
 * Fixture, from the migrations (not hand-copied): profiles as read from prod
 * (scripts/probes/fixtures/null-uid-guards.live.sql) plus every later
 * `ALTER TABLE public.profiles ADD COLUMN`; is_server_context, has_role and
 * prevent_self_escalation at their EFFECTIVE definitions before this file
 * (src/test/helpers/effectiveFunctionDefs.ts); the trigger exactly as prod's
 * pg_get_triggerdef prints it (2026-10-15); the prod UPDATE policy on
 * profiles and the column-level UPDATE grant `authenticated` holds on
 * subscription_source (information_schema.column_privileges, 2026-10-15).
 *
 * Proven:
 *   1. a member writing 'apple' on their own row keeps the stored value
 *      (RED before: it became 'apple');
 *   2. the PATCH still succeeds (1 row, no error): the 7119 client's grant is
 *      not narrowed, the value is just pinned;
 *   3. a member writing NULL over a stored 'stripe' keeps 'stripe';
 *   4. the refused write is logged once as rls-escalation-refused (RED before);
 *   5. a server write (no JWT, service role) still sets it;
 *   6. an admin write still sets it;
 *   7. an ordinary safe field (bio) in the same PATCH still saves.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs.ts";
import { blankSqlComments } from "../helpers/blankNonCode.ts";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} (npm i @electric-sql/pglite there).`);
  process.exit(2);
}

const ROOT = new URL("../../../", import.meta.url).pathname;
const DIR = `${ROOT}supabase/migrations/`;
const mig = (f) => readFileSync(DIR + f, "utf8");
const THIS = "20261015005850_pin_subscription_source_self_write.sql";
const MODE = process.env.NEW_MIGRATION ?? "";
if (MODE) console.log(`NEW_MIGRATION=${MODE}: running against the state BEFORE ${THIS} (expect FAILs)`);
const BEFORE_FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql") && f < THIS).sort();
const DEFS = effectiveDefs(DIR, { before: THIS });

const LIVE = readFileSync(`${ROOT}scripts/probes/fixtures/null-uid-guards.live.sql`, "utf8");
const tableDdl = (t) => new RegExp(`^CREATE TABLE public\\.${t} \\([\\s\\S]*?^\\);`, "m").exec(LIVE)[0];
const LIVE_READ = "20260915";
const LATER_COLUMNS = BEFORE_FILES.filter((f) => f > LIVE_READ)
  .flatMap((f) => [...blankSqlComments(mig(f)).matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?(?:ONLY\s+)?public\.profiles\s+([\s\S]*?);/gi)].map((m) => m[1]))
  .flatMap((body) => [...body.matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)\s+([\w\[\]]+(?:\s+with\s+time\s+zone)?)/gi)].map((m) => `ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ${m[1]} ${m[2]};`))
  .join("\n");

function fnStmt(name) {
  const d = DEFS.get(name);
  if (!d) throw new Error(`no migration before ${THIS} defines ${name}`);
  return d.stmt.trimEnd().endsWith(";") ? d.stmt : `${d.stmt};`;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = (n) => `66666666-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MEMBER = U(1); // a Stripe-billed member, source NULL
const STRIPED = U(2); // source already 'stripe'
const ADMIN = U(3);

const SETUP = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TYPE public.app_role AS ENUM ('admin', 'customer', 'helper');
${tableDdl("profiles")}
${LATER_COLUMNS}
ALTER TABLE public.profiles ADD PRIMARY KEY (user_id);
${tableDdl("user_roles")}
CREATE TABLE public.error_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text, message text, tags jsonb, context jsonb,
  created_at timestamptz DEFAULT now());

${["is_server_context", "has_role", "prevent_self_escalation"].map(fnStmt).join("\n\n")}

CREATE TRIGGER tr_prevent_self_escalation BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION prevent_self_escalation();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update their own safe fields" ON public.profiles FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "Admins can update all profiles" ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (subscription_source, bio, updated_at) ON public.profiles TO authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT SELECT, INSERT ON public.error_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
`;

const db = new PGlite();
await db.exec(SETUP);
if (MODE !== "skip") {
  const sql = mig(THIS);
  for (let i = 0; i < 3; i++) await db.exec(sql);
  check("migration applies 3x (replay-safe)", true);
}

const one = async (sql) => (await db.query(sql)).rows[0];
async function as(role, uid, sql) {
  await db.exec(`SET ROLE ${role};
    SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false);
    SELECT set_config('request.jwt.claim.role', '${role}', false);`);
  try {
    return { ok: true, rows: (await db.query(sql)).rows };
  } catch (e) {
    return { ok: false, error: String(e.message ?? e) };
  } finally {
    await db.exec(`RESET ROLE;
      SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT set_config('request.jwt.claim.role', '', false);`);
  }
}
const source = async (uid) => (await one(`SELECT subscription_source FROM public.profiles WHERE user_id = '${uid}'`)).subscription_source;

await db.exec(`INSERT INTO public.profiles (user_id, email, full_name, subscription_tier, subscription_source) VALUES
  ('${MEMBER}', 'm@pglite.test', 'Member', 'pro', NULL),
  ('${STRIPED}', 's@pglite.test', 'Striped', 'pro', 'stripe'),
  ('${ADMIN}', 'a@pglite.test', 'Admin', NULL, NULL);
INSERT INTO public.user_roles (user_id, role) VALUES ('${ADMIN}', 'admin');`);

// 1, 2, 7
const r1 = await as("authenticated", MEMBER,
  `UPDATE public.profiles SET subscription_source = 'apple', bio = 'hi' WHERE user_id = '${MEMBER}' RETURNING user_id`);
check("the member's PATCH still succeeds (grant not narrowed)", r1.ok && r1.rows.length === 1, r1.error ?? `${r1.rows?.length} row`);
check("a member cannot write 'apple' on their own row", (await source(MEMBER)) === null, `stored ${await source(MEMBER)}`);
check("the safe field in the same PATCH still saves",
  (await one(`SELECT bio FROM public.profiles WHERE user_id = '${MEMBER}'`)).bio === "hi");

// 3
await as("authenticated", STRIPED, `UPDATE public.profiles SET subscription_source = NULL WHERE user_id = '${STRIPED}'`);
check("a member cannot clear a stored 'stripe'", (await source(STRIPED)) === "stripe", `stored ${await source(STRIPED)}`);

// 4
const logged = await one(`SELECT count(*)::int AS n FROM public.error_logs
  WHERE tags->>'source' = 'rls-escalation-refused' AND tags->>'user_id' = '${MEMBER}'`);
check("the refused write is logged as rls-escalation-refused", logged.n === 1, `${logged.n} rows`);

// 5
// As the edge functions write: role service_role, JWT role claim service_role, no sub.
const r5 = await as("service_role", null,
  `UPDATE public.profiles SET subscription_source = 'apple' WHERE user_id = '${MEMBER}' RETURNING user_id`);
check("a service-role write (the webhooks) still sets it", r5.ok && (await source(MEMBER)) === "apple", r5.error ?? `stored ${await source(MEMBER)}`);
await db.exec(`UPDATE public.profiles SET subscription_source = NULL WHERE user_id = '${MEMBER}'`);

// 6
const r6 = await as("authenticated", ADMIN,
  `UPDATE public.profiles SET subscription_source = 'stripe' WHERE user_id = '${MEMBER}' RETURNING user_id`);
check("an admin write still sets it", r6.ok && (await source(MEMBER)) === "stripe", r6.error ?? `stored ${await source(MEMBER)}`);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
