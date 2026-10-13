#!/usr/bin/env node
/**
 * PGlite proof for 20261013000532_payout_hold_release_waits_for_ban_review (Q1415 d).
 *
 *   node src/test/pglite/payoutHoldReleaseWaitsForBanReview.pglite.mjs
 *
 * pglite is loaded from ~/.lh-pglite (override with PGLITE_DIR). Loads the
 * PREVIOUS admin_release_payout_hold verbatim from 20261004162921 and prints
 * "OLD STATE RED" when an admin releases the hold of a Helpr whose ban
 * settlement review is still open (the hold is gone). Then applies the new
 * migration 3x and exits 1 unless: that release raises 'ban_review_open' and
 * the hold stays; a Helpr whose review was lifted (or who has none) is
 * released as before, audited; a non-admin is still refused; the ACL is
 * authenticated + service_role only.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const mig = (f) => readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${f}`, import.meta.url)), "utf8");
const NEW = mig("20261013000532_payout_hold_release_waits_for_ban_review.sql");
const OLD = /CREATE OR REPLACE FUNCTION public\.admin_release_payout_hold[\s\S]*?\n\$fn\$;/.exec(mig("20261004162921_payout_holds_server_side.sql"))[0];

const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const MEMBER = "00000000-0000-4000-8000-0000000000aa";
const H = { open: "00000000-0000-4000-8000-000000000001", lifted: "00000000-0000-4000-8000-000000000002", none: "00000000-0000-4000-8000-000000000003" };

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create type public.app_role as enum ('admin', 'user');
  create table public.user_roles(user_id uuid, role public.app_role);
  create function public.has_role(u uuid, r public.app_role) returns boolean language sql stable as $$ select exists (select 1 from public.user_roles where user_id = u and role = r) $$;
  create table public.payout_holds(helper_id uuid primary key, reason text, held_by uuid, denied_by uuid, held_at timestamptz default now(), denied_at timestamptz);
  create table public.admin_audit_log(admin_id uuid, action text, target_id text, target_type text, details jsonb);
  create table public.ban_settlement_queue(id uuid primary key default gen_random_uuid(), user_id uuid, matched_on text, review_state text);
  insert into public.user_roles values ('${ADMIN}', 'admin');
`);
async function reset() {
  await db.exec(`delete from public.payout_holds; delete from public.admin_audit_log; delete from public.ban_settlement_queue;
    insert into public.payout_holds(helper_id, reason) values ('${H.open}', 'Q1324: review'), ('${H.lifted}', 'admin hold'), ('${H.none}', 'admin hold');
    insert into public.ban_settlement_queue(user_id, matched_on, review_state) values ('${H.open}', 'card', 'open'), ('${H.lifted}', 'card', 'lifted');`);
}
async function release(helper, as = ADMIN) {
  try {
    await db.query(`select set_config('request.jwt.claim.sub', '${as}', false)`);
    const r = await db.query(`select public.admin_release_payout_hold('${helper}') as ok`);
    return { ok: true, value: r.rows[0]?.ok };
  } catch (e) {
    return { ok: false, message: e.message, code: e.code };
  }
}
const held = async (h) => (await db.query(`select count(*)::int n from public.payout_holds where helper_id = '${h}'`)).rows[0].n === 1;

await db.exec(OLD);
await reset();
const old = await release(H.open);
if (old.ok && !(await held(H.open))) console.log("OLD STATE RED: the hold of a Helpr under an open ban review was released");
else { console.error("unexpected old state", old); process.exit(1); }

for (let i = 0; i < 3; i++) await db.exec(NEW);
await reset();
const fails = [];
const r1 = await release(H.open);
if (r1.ok || !/ban_review_open/.test(r1.message ?? "")) fails.push(`open review not refused: ${JSON.stringify(r1)}`);
if (!(await held(H.open))) fails.push("the hold under an open review was deleted");
const r2 = await release(H.lifted);
if (!r2.ok || r2.value !== true || (await held(H.lifted))) fails.push(`lifted review not released: ${JSON.stringify(r2)}`);
const r3 = await release(H.none);
if (!r3.ok || r3.value !== true || (await held(H.none))) fails.push(`no review not released: ${JSON.stringify(r3)}`);
const audits = (await db.query(`select count(*)::int n from public.admin_audit_log where action = 'payout_hold_released'`)).rows[0].n;
if (audits !== 2) fails.push(`expected 2 audit rows, got ${audits}`);
const r4 = await release(H.open, MEMBER);
if (r4.ok || !/admin_only/.test(r4.message ?? "")) fails.push(`non-admin not refused: ${JSON.stringify(r4)}`);
const acl = (await db.query(`select proacl::text a from pg_proc where proname = 'admin_release_payout_hold'`)).rows[0].a;
if (/anon=/.test(acl) || /=X\/\w+,?$/.test(acl.replace(/(postgres|authenticated|service_role)=X\/\w+,?/g, ""))) fails.push(`ACL: ${acl}`);

if (fails.length) {
  console.error("FAIL\n- " + fails.join("\n- "));
  process.exit(1);
}
console.log("NEW STATE GREEN (applied 3x): open review refused, hold kept; lifted/no review released and audited; non-admin refused; ACL", acl);
