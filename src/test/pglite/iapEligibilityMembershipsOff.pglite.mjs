#!/usr/bin/env node
/**
 * PGlite proof for 20261015073024_subscription_eligibility_memberships_off
 * (roadmap F4/F4a; lh-authz-rls note 1 on the memberships switch, 2026-10-15).
 *
 *   node src/test/pglite/iapEligibilityMembershipsOff.pglite.mjs                     # GREEN: applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/iapEligibilityMembershipsOff.pglite.mjs  # RED: the previous body
 *
 * Build 7119's Apple purchase path asks subscription_purchase_eligibility('apple')
 * before the StoreKit sheet and refuses on allowed = false. This proves that a
 * member the 'memberships' switch is off for is refused there (so no Apple charge
 * happens), while testers and admins get exactly the previous answers.
 *
 * Functions run VERBATIM from supabase/migrations: feature_enabled_for_user
 * (newest before the new file), session_email_unconfirmed (newest before), the
 * previous subscription_purchase_eligibility (newest before = 20261005065813),
 * and the 'memberships' switch as 20261015033658 creates it (testers).
 * auth.uid()/auth.role() read the request settings PostgREST sets from the JWT.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const NEW_FILE = "20261015073024_subscription_eligibility_memberships_off.sql";
const RED = process.env.NEW_MIGRATION === "skip";
if (RED) console.log("NEW_MIGRATION=skip: running the PREVIOUS body (expect FAILs)");

/** The newest `CREATE [OR REPLACE] FUNCTION public.<name>(` statement in migrations before `before`. */
function previousDefinition(name, before) {
  let last = null;
  for (const f of readdirSync(MIG_DIR).filter((x) => x.endsWith(".sql") && x < before).sort()) {
    const sql = readFileSync(MIG_DIR + f, "utf8");
    const head = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      const tag = /\bAS\s+(\$\w*\$)/i.exec(rest);
      const end = rest.indexOf(tag[1], tag.index + tag[0].length);
      last = { file: f, text: rest.slice(0, end + tag[1].length) + ";" };
    }
  }
  if (!last) throw new Error(`no previous definition of ${name}`);
  return last;
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const U = {
  member: "44444444-0000-4000-8000-000000000001",       // ordinary confirmed member, free
  tester: "44444444-0000-4000-8000-000000000002",       // in test_accounts (like apple-reviewer), free
  admin: "44444444-0000-4000-8000-000000000003",        // admin app_role, free
  testerUnconf: "44444444-0000-4000-8000-000000000004", // tester with an unconfirmed email
  testerWeb: "44444444-0000-4000-8000-000000000005",    // tester with a live Stripe (website) membership
  memberUnconf: "44444444-0000-4000-8000-000000000006", // member with an unconfirmed email
};

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email_confirmed_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.role', true), '') $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated;
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(p_user uuid, p_role public.app_role) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p_user AND r.role = p_role) $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.feature_switches (key text PRIMARY KEY, audience text, description text);
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, subscription_tier text, subscription_source text,
  subscription_expires_at timestamptz, stripe_subscription_id text, apple_original_transaction_id text);
`);
for (const [k, id] of Object.entries(U)) {
  await db.query("INSERT INTO auth.users VALUES ($1, $2)", [id, /Unconf/.test(k) ? null : new Date(Date.now() - 30 * 864e5).toISOString()]);
  await db.query("INSERT INTO public.profiles (user_id, subscription_tier) VALUES ($1, 'free')", [id]);
}
await db.query(
  "UPDATE public.profiles SET subscription_tier = 'pro', subscription_source = 'stripe', stripe_subscription_id = 'sub_x', subscription_expires_at = now() + interval '20 days' WHERE user_id = $1",
  [U.testerWeb],
);
for (const id of [U.tester, U.testerUnconf, U.testerWeb]) await db.query("INSERT INTO public.test_accounts VALUES ($1)", [id]);
await db.query("INSERT INTO public.user_roles VALUES ($1, 'admin')", [U.admin]);

await db.exec(previousDefinition("feature_enabled_for_user", NEW_FILE).text);
await db.exec(previousDefinition("session_email_unconfirmed", NEW_FILE).text);
const prev = previousDefinition("subscription_purchase_eligibility", NEW_FILE);
console.log(`previous body: ${prev.file}`);
await db.exec(prev.text);
await db.exec(`REVOKE ALL ON FUNCTION public.subscription_purchase_eligibility(text) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.subscription_purchase_eligibility(text) TO authenticated, service_role;
  REVOKE ALL ON FUNCTION public.feature_enabled_for_user(text, uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.session_email_unconfirmed() TO authenticated;`);
// The switch exactly as 20261015033658 creates it (testers).
await db.exec(readFileSync(MIG_DIR + "20261015033658_memberships_switch_off.sql", "utf8"));
if (!RED) {
  const sql = readFileSync(MIG_DIR + NEW_FILE, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
}

async function as(who, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.uid', '${who ?? ""}', false), set_config('request.role', '${who ? "authenticated" : "anon"}', false);`);
  await db.exec(who ? "SET ROLE authenticated" : "SET ROLE anon");
  try { const r = await db.query(sql); return { ok: true, v: r.rows[0]?.v }; }
  catch (e) { return { ok: false, err: e.message }; }
  finally { await db.exec("RESET ROLE"); }
}
const ask = (who, platform) => as(who, `SELECT public.subscription_purchase_eligibility('${platform}') AS v`);
const show = (r) => (r.ok ? JSON.stringify(r.v) : r.err);

const sw = (await db.query("SELECT audience FROM public.feature_switches WHERE key = 'memberships'")).rows[0]?.audience;
check("fixture: memberships switch is at testers", sw === "testers", `got ${sw}`);

for (const platform of ["apple", "stripe"]) {
  const m = await ask(U.member, platform);
  check(`R1 a member the switch is off for is refused, memberships_off (${platform})`,
    m.ok && m.v.allowed === false && m.v.code === "memberships_off" && /not available/.test(m.v.reason), show(m));
  const mu = await ask(U.memberUnconf, platform);
  check(`R2 an unconfirmed member is told memberships are off, not to confirm an email (${platform})`,
    mu.ok && mu.v.allowed === false && mu.v.code === "memberships_off", show(mu));
  const t = await ask(U.tester, platform);
  check(`L1 a tester (test_accounts) is allowed as before (${platform})`, t.ok && t.v.allowed === true && t.v.code === "no_active_subscription", show(t));
  const a = await ask(U.admin, platform);
  check(`L2 an admin is allowed as before (${platform})`, a.ok && a.v.allowed === true && a.v.code === "no_active_subscription", show(a));
  const tu = await ask(U.testerUnconf, platform);
  check(`L3 a tester with an unconfirmed email still gets email_unconfirmed (${platform})`, tu.ok && tu.v.allowed === false && tu.v.code === "email_unconfirmed", show(tu));
}
const tw = await ask(U.testerWeb, "apple");
check("L4 a tester with a live website membership still gets active_subscription_elsewhere on apple", tw.ok && tw.v.allowed === false && tw.v.code === "active_subscription_elsewhere", show(tw));
const tws = await ask(U.testerWeb, "stripe");
check("L5 ... and same_platform_change on stripe", tws.ok && tws.v.allowed === true && tws.v.code === "same_platform_change", show(tws));

const anon = await ask(null, "apple");
check("L6 anon still cannot ask", !anon.ok, show(anon));
const bad = await ask(U.member, "paypal");
check("L7 an invalid platform still raises invalid_platform", !bad.ok && /invalid_platform/.test(bad.err), show(bad));

// Switch flipped to everyone by an admin: members may buy again (the gate is the switch, nothing else).
await db.exec("UPDATE public.feature_switches SET audience = 'everyone' WHERE key = 'memberships'");
const me = await ask(U.member, "apple");
check("L8 with the switch at everyone a member is allowed again", me.ok && me.v.allowed === true, show(me));
// Missing row fails closed: nobody can buy, testers included.
await db.exec("DELETE FROM public.feature_switches WHERE key = 'memberships'");
const tm = await ask(U.tester, "apple");
check("R3 no switch row = off for everyone (fails closed, tester included)", tm.ok && tm.v.allowed === false && tm.v.code === "memberships_off", show(tm));

// Grants restated exactly: no PUBLIC/anon execute, authenticated + service_role keep it.
const acl = (await db.query("SELECT proacl::text AS a FROM pg_proc WHERE proname = 'subscription_purchase_eligibility'")).rows[0].a;
check("G1 grants: authenticated + service_role, no anon, no PUBLIC", /authenticated=X/.test(acl) && /service_role=X/.test(acl) && !/anon=/.test(acl) && !/(^|[{,])=X/.test(acl), acl);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
