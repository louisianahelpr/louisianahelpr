#!/usr/bin/env node
/**
 * PGlite proof for 20261016053527_declutter_add_a_helpr
 * (docs/specs/declutter-add-a-helpr.md).
 *
 *   npx tsx src/test/pglite/declutterAddAHelpr.pglite.mjs [--replay] [--before]
 *
 * With --before the migration is NOT applied and every check must FAIL (the
 * functions do not exist); without it the migration is applied (3x with
 * --replay) and every check must PASS. The hidden-switch functions are the
 * REAL ones (20261012031120 applied first), so the refusal is the one prod runs.
 *
 *   H1 the buyer's pre-fill lists the items and the booked pickup time
 *   H2 an ordinary account (switch off for it) is refused both calls
 *   H3 another tester (not the buyer) gets no pre-fill and cannot link
 *   H4 the buyer links their own open assembly job and the pre-fill lists it
 *   H5 linking again is a yes; the same job cannot move to another order
 *   H6 a job the buyer re-categorised still links (no category gate)
 *   H7 someone else's job is refused
 *   H8 an unpaid order offers nothing and links nothing
 *   H9 the offer stands 30 days after the handover, not 31
 *   H10 anon cannot call either function
 *   H11 an unpaid job that is deleted takes its link with it (FK CASCADE)
 *   H12 a signed-in member cannot read or write the link table directly
 *   H13 the switch is created as testers, never on for everyone
 *   H14 a handed-over order with no dates fails closed (lh-authz-rls review #5)
 */
import { readFileSync } from "node:fs";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261016053527_declutter_add_a_helpr.sql";
const SWITCHES = "20261012031120_hidden_feature_switches.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before");

let failures = 0;
let checks = 0;
const check = (name, ok, detail = "") => {
  checks++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BUYER = U(1), SELLER = U(2), OTHER = U(3), PLAIN = U(4);
const ORDER = U(10), ORDER2 = U(11), UNPAID = U(12), OLD = U(13), RECENT = U(14), NODATES = U(15);
const ITEM1 = U(20), ITEM2 = U(21);
const JOB = U(30), CLEANING = U(31), OTHERJOB = U(32), ORPHAN = U(33), JOB2 = U(34);

const db = new PGlite();
await db.exec(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TYPE public.job_category AS ENUM ('assembly', 'handyman', 'cleaning');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(p_user uuid, p_role public.app_role) RETURNS boolean LANGUAGE sql STABLE
  AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user AND role = p_role) $$;
CREATE TABLE public.test_accounts (user_id uuid PRIMARY KEY);
CREATE TABLE public.admin_audit_log (id bigserial, admin_id uuid, action text, target_type text, target_id text, details jsonb);
CREATE TABLE public.platform_settings (key text PRIMARY KEY, value jsonb);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, title text, category public.job_category NOT NULL,
  status text NOT NULL DEFAULT 'open', payment_status text NOT NULL DEFAULT 'unpaid');
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, title text NOT NULL);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid NOT NULL, seller_id uuid NOT NULL,
  status text NOT NULL, handover text NOT NULL DEFAULT 'pickup_home', paid_at timestamptz, handed_over_at timestamptz, closed_at timestamptz);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, order_id uuid,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.declutter_bookings (order_id uuid PRIMARY KEY, slot_start timestamptz);
INSERT INTO public.test_accounts VALUES ('${BUYER}'), ('${OTHER}');
INSERT INTO public.declutter_items VALUES ('${ITEM1}', 'Oak bookshelf'), ('${ITEM2}', '55 inch TV');
INSERT INTO public.declutter_orders (id, buyer_id, seller_id, status, paid_at, handed_over_at) VALUES
  ('${ORDER}', '${BUYER}', '${SELLER}', 'paid', now(), NULL),
  ('${ORDER2}', '${BUYER}', '${SELLER}', 'paid', now(), NULL),
  ('${UNPAID}', '${BUYER}', '${SELLER}', 'awaiting_payment', NULL, NULL),
  ('${OLD}', '${BUYER}', '${SELLER}', 'handed_over', now() - interval '40 days', now() - interval '31 days'),
  ('${RECENT}', '${BUYER}', '${SELLER}', 'handed_over', now() - interval '10 days', now() - interval '29 days'),
  ('${NODATES}', '${BUYER}', '${SELLER}', 'handed_over', NULL, NULL);
INSERT INTO public.declutter_cart_items (item_id, buyer_id, order_id, created_at) VALUES
  ('${ITEM1}', '${BUYER}', '${ORDER}', now() - interval '1 minute'), ('${ITEM2}', '${BUYER}', '${ORDER}', now());
INSERT INTO public.declutter_bookings VALUES ('${ORDER}', '2026-10-20T15:00:00Z');
INSERT INTO public.jobs (id, customer_id, title, category) VALUES
  ('${JOB}', '${BUYER}', 'Put together a bookshelf', 'assembly'),
  ('${JOB2}', '${BUYER}', 'Hang a TV', 'handyman'),
  ('${CLEANING}', '${BUYER}', 'Clean the den', 'cleaning'),
  ('${OTHERJOB}', '${OTHER}', 'Someone else', 'assembly'),
  ('${ORPHAN}', '${BUYER}', 'Abandoned post', 'assembly');
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT DELETE ON public.jobs TO authenticated;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY jobs_read ON public.jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY jobs_delete_own_unpaid ON public.jobs FOR DELETE TO authenticated
  USING (customer_id = auth.uid() AND payment_status = 'unpaid');
`);
await db.exec(readFileSync(DIR + SWITCHES, "utf8"));
if (!BEFORE) {
  for (let i = 1; i <= (REPLAY ? 3 : 1); i++) {
    try { await db.exec(MIGRATION); console.log(`applied ${THIS} (run ${i})`); }
    catch (e) { check(`migration applies (run ${i})`, false, e.message); }
  }
} else console.log(`--before: ${THIS} NOT applied (every check must FAIL)`);

// Calls run as the authenticated role with the given auth.uid(), like PostgREST.
const as = async (uid, role = "authenticated") => {
  await db.exec("RESET ROLE");
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false)`);
  await db.exec(`SET ROLE ${role}`);
};
const q = async (sql) => {
  try { return { rows: (await db.query(sql)).rows }; }
  catch (e) { return { err: e.message }; }
};
const prefill = async (order) => {
  const r = await q(`SELECT public.declutter_setup_helpr('${order}') AS r`);
  return r.err ? r : { r: r.rows[0].r };
};
const link = async (order, job) => {
  const r = await q(`SELECT public.declutter_link_setup_job('${order}', '${job}') AS r`);
  return r.err ? r : { r: r.rows[0].r };
};
const linkOf = async (job) => {
  await db.exec("RESET ROLE");
  const r = await q(`SELECT order_id FROM public.declutter_order_jobs WHERE job_id = '${job}'`);
  return r.err ? `ERR ${r.err}` : (r.rows[0]?.order_id ?? null);
};

await as(BUYER);
const h1 = await prefill(ORDER);
check("H1 the buyer's pre-fill lists the items and the booked pickup time",
  JSON.stringify(h1.r?.items) === JSON.stringify(["Oak bookshelf", "55 inch TV"])
  && new Date(h1.r?.pickup_at).toISOString() === "2026-10-20T15:00:00.000Z"
  && Array.isArray(h1.r?.jobs) && h1.r.jobs.length === 0 && h1.r.status === "paid",
  JSON.stringify(h1));

await as(PLAIN);
const h2a = await prefill(ORDER);
const h2b = await link(ORDER, JOB);
check("H2 an ordinary account (switch off for it) is refused both calls",
  /feature_disabled/.test(h2a.err ?? "") && /feature_disabled/.test(h2b.err ?? "") && (await linkOf(JOB)) === null,
  JSON.stringify([h2a, h2b]));

await as(OTHER);
const h3a = await prefill(ORDER);
const h3b = await link(ORDER, OTHERJOB);
check("H3 another tester (not the buyer) gets no pre-fill and cannot link",
  /item_not_found/.test(h3a.err ?? "") && h3b.r === false && (await linkOf(OTHERJOB)) === null,
  JSON.stringify([h3a, h3b]));

await as(BUYER);
const h4 = await link(ORDER, JOB);
await as(BUYER);
const h4p = await prefill(ORDER);
check("H4 the buyer links their own open assembly job and the pre-fill lists it",
  h4.r === true && (await linkOf(JOB)) === ORDER && h4p.r?.jobs?.length === 1
  && h4p.r.jobs[0].job_id === JOB && h4p.r.jobs[0].category === "assembly" && h4p.r.jobs[0].payment_status === "unpaid",
  JSON.stringify([h4, h4p]));

await as(BUYER);
const h5a = await link(ORDER, JOB);
await as(BUYER);
const h5b = await link(ORDER2, JOB);
check("H5 linking again is a yes; the same job cannot move to another order",
  h5a.r === true && h5b.r === false && (await linkOf(JOB)) === ORDER, JSON.stringify([h5a, h5b]));

await as(BUYER);
const h6 = await link(ORDER, CLEANING);
await as(BUYER);
const h6b = await link(ORDER, JOB2);
check("H6 a job the buyer re-categorised still links (no category gate)",
  h6.r === true && (await linkOf(CLEANING)) === ORDER && h6b.r === true, JSON.stringify([h6, h6b]));

await as(BUYER);
const h7 = await link(ORDER, OTHERJOB);
check("H7 someone else's job is refused", /not your open job/.test(h7.err ?? "") && (await linkOf(OTHERJOB)) === null, JSON.stringify(h7));

await as(BUYER);
const h8a = await prefill(UNPAID);
await as(BUYER);
const h8b = await link(UNPAID, ORPHAN);
check("H8 an unpaid order offers nothing and links nothing",
  /item_not_found/.test(h8a.err ?? "") && h8b.r === false && (await linkOf(ORPHAN)) === null, JSON.stringify([h8a, h8b]));

await as(BUYER);
const h9a = await prefill(OLD);
await as(BUYER);
const h9b = await prefill(RECENT);
await as(BUYER);
const h9c = await link(OLD, ORPHAN);
check("H9 the offer stands 30 days after the handover, not 31",
  /item_not_found/.test(h9a.err ?? "") && h9b.r?.status === "handed_over" && h9c.r === false, JSON.stringify([h9a, h9b, h9c]));

await as(null, "anon");
const h10a = await prefill(ORDER);
const h10b = await link(ORDER, ORPHAN);
check("H10 anon cannot call either function",
  /permission denied/.test(h10a.err ?? "") && /permission denied/.test(h10b.err ?? ""), JSON.stringify([h10a, h10b]));

await as(BUYER);
const h11a = await link(ORDER, ORPHAN);
// As prod's cleanupOrphanJob does it: the buyer deletes their own unpaid job as
// authenticated, with no privilege on the link table (lh-money-escrow review #2).
await as(BUYER);
const h11b = await q(`DELETE FROM public.jobs WHERE id = '${ORPHAN}' RETURNING id`);
check("H11 an unpaid job that is deleted takes its link with it (FK CASCADE)",
  h11a.r === true && h11b.rows?.length === 1 && (await linkOf(ORPHAN)) === null, JSON.stringify([h11a, h11b]));

await as(BUYER);
const h12a = await q("SELECT * FROM public.declutter_order_jobs");
const h12b = await q(`INSERT INTO public.declutter_order_jobs (job_id, order_id, purpose) VALUES ('${U(99)}', '${ORDER}', 'setup')`);
check("H12 a signed-in member cannot read or write the link table directly",
  /permission denied/.test(h12a.err ?? "") && /permission denied/.test(h12b.err ?? ""), JSON.stringify([h12a, h12b]));

await db.exec("RESET ROLE");
const h13 = await q("SELECT audience FROM public.feature_switches WHERE key = 'declutter_add_helpr'");
check("H13 the switch is created as testers, never on for everyone", h13.rows?.[0]?.audience === "testers", JSON.stringify(h13));

await as(BUYER);
const h14a = await prefill(NODATES);
await as(BUYER);
const h14b = await link(NODATES, CLEANING);
check("H14 a handed-over order with no dates fails closed (lh-authz-rls review #5)",
  /item_not_found/.test(h14a.err ?? "") && (h14b.r === false || /not your open job/.test(h14b.err ?? "")), JSON.stringify([h14a, h14b]));

const expected = 14;
console.log(`\n${checks - failures}/${checks} passed (expected ${expected} checks)`);
if (BEFORE) {
  process.exit(failures === checks && checks === expected ? 0 : 1);
}
process.exit(failures === 0 && checks === expected ? 0 : 1);
