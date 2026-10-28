#!/usr/bin/env node
/**
 * PGlite proof for 20261027222743_declutter_donate (Q2428, owner 2026-10-27: donate what doesn't sell), on the
 * haul-away world (declutterHaulAway.pglite.mjs: slices 1-4, F1, lane J, porch default, Helpr delivery, seller-out
 * fee, then 20261017070827_declutter_haul_away), with the donate migration applied 3 times.
 *
 * Covers: admins curate partner charities (members cannot); partners near the seller's items (a far or inactive one
 * is never offered, another seller's item reads as missing); the seller chooses or clears a charity (5-mile rules,
 * unsold items only); a job that holds the items locks the choice; the haul-away job COMPLETED with the charity named
 * in its description writes the receipt (item, date, charity; no value) and one bell; a job that does not name it
 * writes none; a full refund (items back on sale) takes the receipt away; the grants.
 *
 *   node src/test/pglite/declutterDonate.pglite.mjs                      # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterDonate.pglite.mjs   # RED: the migration absent
 *   MIGRATION_PATH=<planted copy> node src/test/pglite/declutterDonate.pglite.mjs
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import os from "node:os";
import { readFileSync } from "node:fs";
import { setupStatements, liveItemSql, CARDS_SQL, USERS, FEE_F1_FILE, SLICE4_FILE } from "../../../scripts/declutter/slice3Harness.mjs";

const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const HAUL_FILE = "20261017070827_declutter_haul_away.sql";
const THIS_FILE = "20261027222743_declutter_donate.sql";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const { SELLER, SELLER2, BUYER, ADMIN, BANNED } = USERS;
const skip = process.env.NEW_MIGRATION === "skip";

const db = new PGlite();
await db.exec(`CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]);
  INSERT INTO storage.buckets (id, name, public) VALUES ('job-photos', 'job-photos', true);`);
const setup = setupStatements({ times: 1, times3b: 1, extra: [FEE_F1_FILE, SLICE4_FILE,
  "20261017055500_declutter_refund_hand_settle.sql", "20261017055502_declutter_handover_private_bucket.sql",
  "20261017055504_declutter_porch_default.sql", "20261017055505_declutter_helpr_delivery.sql",
  "20261017060455_declutter_seller_out_pays_fee.sql"].map((file) => ({ file, times: 1 })) });
setup.splice(1, 0, `
  ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
  CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
    violation_type text NOT NULL, description text, job_id uuid, action_taken text, created_at timestamptz DEFAULT now());
  CREATE TABLE public.cron_defects (fn text, ref text, msg text);
  CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text) RETURNS void LANGUAGE sql
    AS $$ INSERT INTO public.cron_defects VALUES (p_fn, p_ref, p_msg) $$;
  CREATE FUNCTION public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text,
    p_job_id uuid, p_prior_count int, p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean,
    p_suspension_days int, p_clamp_to_worse_status boolean, p_admin_message_format text, p_ban_reason text)
  RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;`);
for (const sql of setup) await db.exec(sql);
await db.exec(CARDS_SQL);
// public.jobs with the live columns these migrations read (the haul-away proof's stub plus description).
await db.exec(`CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid,
  status text NOT NULL DEFAULT 'open', payment_status text DEFAULT 'unpaid', stripe_session_id text, description text);
  ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
  GRANT SELECT, DELETE ON public.jobs TO authenticated;
  CREATE POLICY jobs_read ON public.jobs FOR SELECT TO authenticated USING (customer_id = auth.uid());`);
await db.exec(readFileSync(`${MIG_DIR}${HAUL_FILE}`, "utf8"));
await db.exec(`UPDATE public.feature_switches SET audience = 'testers' WHERE key IN ('declutter', 'declutter_haul_away');`);
if (!skip) {
  const sql = readFileSync(process.env.MIGRATION_PATH ?? `${MIG_DIR}${THIS_FILE}`, "utf8");
  for (let i = 0; i < 3; i++) await db.exec(sql);
}

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) pass++; else fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };
const svc = async (sql) => { try { return (await db.query(sql)).rows; } catch (e) { return { error: String(e.message ?? e), code: e.code }; } };
async function me(uid, sql) {
  try {
    await db.exec(`SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return { error: String(e.message ?? e), code: e.code };
  } finally {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub;`);
  }
}
async function anon(sql) {
  try { await db.exec(`SET ROLE anon;`); return (await db.query(sql)).rows; }
  catch (e) { return { error: String(e.message ?? e), code: e.code }; }
  finally { await db.exec(`RESET ROLE;`); }
}
const refused = (r, re) => !Array.isArray(r) && typeof r?.error === "string" && re.test(r.error);
const one = (r) => (Array.isArray(r) && r[0] ? Object.values(r[0])[0] : undefined);
const I = (n) => `66666666-0000-0000-0000-${String(n).padStart(12, "0")}`;
const J = (n) => `77777777-0000-0000-0000-${String(n).padStart(12, "0")}`;
const arr = (ids) => `ARRAY[${ids.map((x) => `'${x}'`).join(",")}]::uuid[]`;
const save = (uid, name, lat, lng, active = true, id = null) =>
  me(uid, `SELECT public.admin_declutter_save_donation_partner(${id ? `'${id}'` : "NULL"}, 'East Baton Rouge', '${name}',
    '100 Charity Way, Baton Rouge, LA', ${lat}, ${lng}, 'Furniture, clothes, housewares', ${active}) AS id`);
const near = (uid, ids) => me(uid, `SELECT * FROM public.declutter_donation_partners_near(${arr(ids)})`);
const choose = (uid, ids, pid) => me(uid, `SELECT public.declutter_choose_donation(${arr(ids)}, ${pid ? `'${pid}'` : "NULL"}) AS n`);
const mine = async (uid) => {
  const r = await me(uid, `SELECT * FROM public.declutter_my_donations()`);
  return Array.isArray(r) ? Object.fromEntries(r.map((x) => [x.item_id, x])) : r;
};
const notes = async (uid, title) => one(await svc(`SELECT count(*)::int FROM public.notifications WHERE user_id = '${uid}' AND title = '${title}'`));

// Items 1-3: SELLER's, unsold 20 days, picked up in Baton Rouge (30.451234, -91.154321). 4: SELLER2's. 5: sold.
for (const n of [1, 2, 3, 5]) await db.exec(liveItemSql({ id: I(n), title: `Donate item ${n}`, liveHoursAgo: 480 }));
await db.exec(liveItemSql({ id: I(4), seller: SELLER2, title: "Other seller lamp", liveHoursAgo: 480 }));
await svc(`UPDATE public.declutter_items SET status = 'sold' WHERE id = '${I(5)}'`);

// D1. Admins curate partners; members cannot.
let P1;
let PFAR;
let POFF;
{
  ok(refused(await save(SELLER, "Goodwill Mid-City", 30.45, -91.15), /admin_only/), "a member cannot add a partner");
  P1 = one(await save(ADMIN, "Goodwill Mid-City", 30.45, -91.15));
  ok(typeof P1 === "string", `an admin adds a partner (${P1})`);
  PFAR = one(await save(ADMIN, "St. Vincent de Paul New Orleans", 29.95, -90.07));
  POFF = one(await save(ADMIN, "Closed Thrift", 30.452, -91.152, false));
  ok(refused(await save(ADMIN, "Off the map", 40.0, -91.15), /donation_partner_invalid/), "a point outside Louisiana is refused");
  ok(refused(await save(ADMIN, "N".repeat(81), 30.45, -91.15), /donation_partner_invalid/), "a name over 80 characters says why (not a raw CHECK)");
  ok(refused(await me(SELLER, `SELECT * FROM public.declutter_donation_partners`), /permission denied/) === false
    && (await me(SELLER, `SELECT count(*)::int AS n FROM public.declutter_donation_partners`))?.[0]?.n === 0,
    "a member reads no partner rows directly (admin-only RLS)");
  ok(one(await svc(`SELECT count(*)::int FROM public.admin_audit_log WHERE action = 'declutter_donation_partner_added'`)) === 3,
    "each add is in the admin audit log");
}

// D2. Partners near the seller's items.
{
  const r = await near(SELLER, [I(1), I(2)]);
  ok(Array.isArray(r) && r.length === 1 && r[0].id === P1 && r[0].miles <= 1 && r[0].chosen === false,
    `only the active partner within 30 miles is offered (${JSON.stringify(Array.isArray(r) ? r.map((x) => [x.name, x.miles]) : r)})`);
  ok(refused(await near(SELLER, [I(1), I(4)]), /item_not_found/), "another seller's item reads as missing");
  ok(refused(await near(BUYER, [I(1)]), /item_not_found/), "a member who is not the seller reads nothing");
}

// D3. Choose, re-read, clear, choose again.
{
  ok(refused(await choose(SELLER, [I(1)], PFAR), /donation_partner_unavailable/), "a partner too far away is refused");
  ok(refused(await choose(SELLER, [I(1)], POFF), /donation_partner_unavailable/), "an inactive partner is refused");
  ok(refused(await choose(SELLER, [I(5)], P1), /haul_away_not_unsold/), "a sold item cannot be donated");
  ok(refused(await choose(BANNED, [I(1)], P1), /account_restricted|item_not_found/), "a banned caller is refused");
  ok(one(await choose(SELLER, [I(1), I(2)], P1)) === 2, "the seller picks the charity for two items");
  let m = await mine(SELLER);
  ok(m[I(1)]?.partner_name === "Goodwill Mid-City" && m[I(1)]?.receipt === false && m[I(1)]?.donated_at === null,
    "the choice reads back, no receipt yet");
  ok((await near(SELLER, [I(1)]))?.[0]?.chosen === true, "the partner list marks the chosen one");
  ok(one(await choose(SELLER, [I(2)], null)) === 0 && !(await mine(SELLER))[I(2)], "clearing removes the choice");
  await choose(SELLER, [I(2)], P1);
  // An admin renaming the partner later never rewrites the seller's choice (a snapshot).
  await save(ADMIN, "Goodwill (renamed)", 30.45, -91.15, true, P1);
  m = await mine(SELLER);
  ok(m[I(1)]?.partner_name === "Goodwill Mid-City", "an admin edit never rewrites a choice already made");
}

// D4. A job that holds the items locks the choice (the charity was written into it).
{
  await svc(`INSERT INTO public.jobs (id, customer_id, status, payment_status, description)
    VALUES ('${J(1)}', '${SELLER}', 'open', 'unpaid', 'Haul away 2 items. Drop off at Goodwill Mid-City, 100 Charity Way.')`);
  const l = await me(SELLER, `SELECT public.declutter_link_haul_away(${arr([I(1), I(2)])}, '${J(1)}') AS n`);
  ok(Array.isArray(l) && one(l) === 2, `the items link to the haul-away job${Array.isArray(l) ? "" : `: ${l.error}`}`);
  ok(refused(await choose(SELLER, [I(1)], null), /donation_locked/), "once a job holds the items the charity cannot change");
}

// D5. The job is done: receipts for each item whose chosen charity the job names, one bell.
{
  await svc(`UPDATE public.jobs SET payment_status = 'escrow' WHERE id = '${J(1)}'`);
  await svc(`UPDATE public.jobs SET status = 'completed', payment_status = 'released' WHERE id = '${J(1)}'`);
  const m = await mine(SELLER);
  ok(m[I(1)]?.receipt === true && m[I(2)]?.receipt === true && m[I(1)]?.donated_at !== null,
    `a completed job naming the charity writes both receipts (${JSON.stringify([m[I(1)]?.receipt, m[I(2)]?.receipt])})`);
  ok(m[I(1)]?.partner_address === "100 Charity Way, Baton Rouge, LA" && !("value_cents" in (m[I(1)] ?? {})),
    "a receipt is the item, the date and the charity; no value anywhere");
  ok(await notes(SELLER, "Donation receipt") === 1, "the seller gets one bell for the job");
  ok(refused(await choose(SELLER, [I(1)], P1), /donation_already_done|donation_locked/), "a donated item cannot be re-chosen");
  // Completed again (a status write that repeats) never writes a second bell.
  await svc(`UPDATE public.jobs SET status = 'completed' WHERE id = '${J(1)}'`);
  ok(await notes(SELLER, "Donation receipt") === 1, "a repeated completed write never notifies twice");
}

// D6. A job that does not name the charity writes no receipt (the Helpr was never told where).
{
  await choose(SELLER, [I(3)], P1);
  await svc(`INSERT INTO public.jobs (id, customer_id, status, payment_status, description)
    VALUES ('${J(2)}', '${SELLER}', 'open', 'unpaid', 'Haul away 1 item to wherever takes it.')`);
  await me(SELLER, `SELECT public.declutter_link_haul_away(${arr([I(3)])}, '${J(2)}') AS n`);
  await svc(`UPDATE public.jobs SET status = 'completed', payment_status = 'released' WHERE id = '${J(2)}'`);
  const m = await mine(SELLER);
  ok(m[I(3)]?.receipt === false && m[I(3)]?.donated_at === null, "a job that never named the charity writes no receipt");
  ok(one(await svc(`SELECT count(*)::int FROM public.cron_defects WHERE fn LIKE 'declutter_donation_job_completed%'`)) === 0,
    "no failure was logged");
}

// D7. The receipt lives only while the job is still the item's haul-away: an item whose link is gone (here removed
//     by hand, as an ops repair would) loses its receipt while the job itself is unchanged...
{
  await svc(`DELETE FROM public.declutter_haul_aways WHERE item_id = '${I(2)}'`);
  const m = await mine(SELLER);
  ok(m[I(1)]?.receipt === true && !m[I(2)], "an item no longer linked to the completed job shows no receipt; the other keeps its own");
}
// ... and a full refund puts the items back on sale (20261017070827 H12): the receipt goes with it.
{
  await svc(`UPDATE public.jobs SET payment_status = 'refunded' WHERE id = '${J(1)}'`);
  const m = await mine(SELLER);
  ok(!m[I(1)] && !m[I(2)], "a job refunded in full shows no receipt (the items went back on sale)");
  // lh-authz-rls review #1: the voided receipt never blocks the item: choose again (the partner's CURRENT name is
  // snapshotted, renamed in D3), and a new donation job naming it writes a new receipt.
  ok(one(await choose(SELLER, [I(1)], P1)) === 1, "the refunded item can be given a charity again");
  await svc(`INSERT INTO public.jobs (id, customer_id, status, payment_status, description)
    VALUES ('${J(3)}', '${SELLER}', 'open', 'unpaid', 'Drop off at Goodwill (renamed), 100 Charity Way.')`);
  const relink = await me(SELLER, `SELECT public.declutter_link_haul_away(${arr([I(1)])}, '${J(3)}') AS n`);
  await svc(`UPDATE public.jobs SET status = 'completed', payment_status = 'released' WHERE id = '${J(3)}'`);
  const m2 = await mine(SELLER);
  ok(Array.isArray(relink) && m2[I(1)]?.receipt === true, `and the second donation job writes a fresh receipt${Array.isArray(relink) ? "" : `: ${relink.error}`}`);
}
// The receipt needs the job's "Drop off at <charity>," line, not just the name somewhere in it.
{
  await choose(SELLER, [I(2)], P1);
  await svc(`INSERT INTO public.jobs (id, customer_id, status, payment_status, description)
    VALUES ('${J(4)}', '${SELLER}', 'open', 'unpaid', 'Haul away. Goodwill (renamed) is closed, the dump is fine.')`);
  await me(SELLER, `SELECT public.declutter_link_haul_away(${arr([I(2)])}, '${J(4)}') AS n`);
  await svc(`UPDATE public.jobs SET status = 'completed', payment_status = 'released' WHERE id = '${J(4)}'`);
  ok((await mine(SELLER))[I(2)]?.receipt === false, "a description that mentions the charity without the drop-off line writes no receipt");
}

// D8. Grants.
{
  ok(refused(await anon(`SELECT * FROM public.declutter_donation_partners_near(${arr([I(1)])})`), /permission denied/), "anon cannot list partners");
  ok(refused(await anon(`SELECT public.declutter_choose_donation(${arr([I(1)])}, NULL)`), /permission denied/), "anon cannot choose");
  ok(refused(await me(SELLER, `SELECT * FROM public.declutter_donations`), /permission denied/), "members cannot read the donations table");
  ok(one(await svc(`SELECT has_function_privilege('authenticated', 'public.declutter_donation_job_completed()', 'EXECUTE')`)) === false,
    "members cannot run the receipt trigger function");
  ok(one(await svc(`SELECT has_function_privilege('authenticated', 'public.declutter_donation_partner_miles(uuid, uuid[])', 'EXECUTE')`)) === false,
    "members cannot run the distance helper");
}

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
