#!/usr/bin/env node
/**
 * PGlite proof for 20261017073146_declutter_add_a_helpr
 * (docs/specs/declutter-add-a-helpr.md).
 *
 *   node src/test/pglite/declutterAddAHelpr.pglite.mjs --replay                    # all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterAddAHelpr.pglite.mjs --replay # RED: the migration absent
 *   node src/test/pglite/declutterAddAHelpr.pglite.mjs --before                    # exits 0 only if EVERY check fails
 *
 * With --before (or NEW_MIGRATION=skip) the migration is NOT applied and every
 * check must FAIL (the functions do not exist); without it the migration is
 * applied (3x with --replay) and every check must PASS. NEW_MIGRATION=skip
 * exits 1 (red); --before inverts the exit so a step can assert "all red". The hidden-switch functions are the
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
 *   H15 a banned tester is refused the link (account_restricted), nothing linked
 *   H16 with Declutter's own switch off, the buyer is refused both calls
 *   H17 the buyer's own open job that is already paid for is refused (job_already_funded)
 *   H18 NULL arguments never link (the reason in scripts/ci/null-arg-validators.sql):
 *       a NULL job raises 'not your open job', a NULL order answers false
 *
 * Before any check, the proof asserts that every migration file it loads is
 * tracked at HEAD and exists on one of BASE_REFS (default: origin/main and the
 * Declutter stack, origin/ready/declutter-stack; origin/main only once the stack merges), or is THIS: it must never run on
 * another unmerged branch's migrations. That precondition exits 1 on its own.
 *
 * Stage 2 A1-A10 (owner rule A10, 2026-10-17): a seller-fault Declutter refund cancels the buyer's linked
 * live setup job with no fee, no strike and a marker (A1), tells buyer and Helpr (A2), leaves finished,
 * done-marked (A3) and crew (A4, logged) jobs, ignores a refund that is not the seller's fault (A5), never
 * blocks the refund write (A6); declutter_setup_job_fee_debt adds the job's card fee to the seller's debt
 * once (A7), refuses an unmarked job or a bad fee (A8), is capped at the job's charge (A9), service only (A10);
 * through the buyer's own declutter_report_no_show a committed job is left for an admin (A11), an uncommitted
 * one is cancelled (A12); one failing job never undoes another's cancel (A13); the marker outlives the order
 * (A14); A10's cancel sends no "the poster cancelled" back-out email (A15, the restated record_backout_notice);
 * declutter_admin_apply_seller_fault applies it by hand, admin only, once, audited (A16), only to a seller-fault
 * refund (A17) whose order still exists (A17b); a job whose money is not at rest is left and logged (A18).
 *
 * Stage 2 (P1-P6) runs the same migration on the REAL Declutter schema
 * (slices 1-4, F1, porch default and Helpr delivery 20261017055505, through
 * scripts/declutter/slice3Harness.mjs) with jobs stubbed, so the columns and
 * statuses it reads are the ones prod has, and a DELIVERY order (handover
 * 'delivery', no seller booking: the Helpr picks the time) is offered too.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261017073146_declutter_add_a_helpr.sql";
const SWITCHES = "20261012031120_hidden_feature_switches.sql";
const MIGRATION = readFileSync(DIR + THIS, "utf8");
const REPLAY = process.argv.includes("--replay");
const BEFORE = process.argv.includes("--before") || process.env.NEW_MIGRATION === "skip";
const INVERT = process.argv.includes("--before");

let failures = 0;
let checks = 0;
const check = (name, ok, detail = "") => {
  checks++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BUYER = U(1), SELLER = U(2), OTHER = U(3), PLAIN = U(4), BANNED = U(5);
const ORDER = U(10), ORDER2 = U(11), UNPAID = U(12), OLD = U(13), RECENT = U(14), NODATES = U(15);
const ITEM1 = U(20), ITEM2 = U(21);
const JOB = U(30), CLEANING = U(31), OTHERJOB = U(32), ORPHAN = U(33), JOB2 = U(34), FUNDED = U(35), BANNEDJOB = U(36);
const BANNED_ORDER = U(16);
const SOUT_ORDER = U(17), RELINK = U(37), CHARGED = U(38), SOUTJOB = U(39);

// Precondition (E): the proof loads only migrations that are on main or the
// Declutter stack (or THIS). A file from another unmerged branch would make a
// green run here prove nothing about what lands.
const { newestDefinition, SLICE3_FILE: H_S3, SLICE3B_FILE: H_S3B, PRICE_CAP_FILE: H_CAP, FEE_F1_FILE: H_F1, SLICE4_FILE: H_S4 } =
  await import("../../../scripts/declutter/slice3Harness.mjs");
const STAGE2_EXTRA = [H_F1, H_S4, "20261017055500_declutter_refund_hand_settle.sql",
  "20261017055502_declutter_handover_private_bucket.sql", "20261017055504_declutter_porch_default.sql",
  "20261017055505_declutter_helpr_delivery.sql", "20261017060455_declutter_seller_out_pays_fee.sql"];
{
  const REPO = new URL("../../../", import.meta.url).pathname;
  const git = (...a) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const refs = (process.env.BASE_REFS ?? "origin/main origin/ready/declutter-stack").split(/\s+/).filter(Boolean)
    .filter((r) => { try { git("rev-parse", "--verify", "--quiet", r); return true; } catch { return false; } });
  const loaded = new Set([SWITCHES, THIS, "20261014193955_declutter_foundation.sql", "20261014200728_declutter_slice2_followups.sql",
    H_S3, H_S3B, H_CAP, ...STAGE2_EXTRA,
    ...["is_caller_banned", "member_under_18", "helper_award_block_reason", "contact_leak_reason", "are_users_blocked"]
      .map((n) => newestDefinition(n).file)]);
  const bad = [];
  for (const f of loaded) {
    const path = `supabase/migrations/${f}`;
    try { git("ls-files", "--error-unmatch", path); } catch { bad.push(`${f}: not tracked at HEAD`); continue; }
    if (f === THIS) continue;
    if (!refs.some((r) => { try { git("cat-file", "-e", `${r}:${path}`); return true; } catch { return false; } }))
      bad.push(`${f}: on none of ${refs.join(", ") || "(no base ref found)"}`);
  }
  if (refs.length === 0 || bad.length) {
    console.log(`PRECONDITION FAILED: the proof must load only main + stack migrations\n  ${bad.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`precondition: ${loaded.size} migrations loaded, all on ${refs.join(" / ")} (or THIS)`);
}

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
CREATE TABLE public.profiles (user_id uuid PRIMARY KEY, ban_status text NOT NULL DEFAULT 'active', auto_suspended_until timestamptz);
INSERT INTO public.profiles (user_id, ban_status) VALUES ('${BUYER}', 'active'), ('${OTHER}', 'active'), ('${BANNED}', 'banned');
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, title text, category public.job_category NOT NULL,
  status text NOT NULL DEFAULT 'open', payment_status text NOT NULL DEFAULT 'unpaid');
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, title text NOT NULL);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY, buyer_id uuid NOT NULL, seller_id uuid NOT NULL,
  status text NOT NULL, handover text NOT NULL DEFAULT 'pickup_home', paid_at timestamptz, handed_over_at timestamptz, closed_at timestamptz);
CREATE TABLE public.declutter_cart_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid, buyer_id uuid, order_id uuid,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.declutter_bookings (order_id uuid PRIMARY KEY, slot_start timestamptz);
-- A10's FK and trigger target (stage 2 runs them on the real refund table).
CREATE TABLE public.declutter_refunds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid, fee_policy text NOT NULL,
  is_seed boolean NOT NULL DEFAULT false);
INSERT INTO public.test_accounts VALUES ('${BUYER}'), ('${OTHER}'), ('${BANNED}');
INSERT INTO public.declutter_items VALUES ('${ITEM1}', 'Oak bookshelf'), ('${ITEM2}', '55 inch TV');
INSERT INTO public.declutter_orders (id, buyer_id, seller_id, status, paid_at, handed_over_at) VALUES
  ('${ORDER}', '${BUYER}', '${SELLER}', 'paid', now(), NULL),
  ('${ORDER2}', '${BUYER}', '${SELLER}', 'paid', now(), NULL),
  ('${UNPAID}', '${BUYER}', '${SELLER}', 'awaiting_payment', NULL, NULL),
  ('${OLD}', '${BUYER}', '${SELLER}', 'handed_over', now() - interval '40 days', now() - interval '31 days'),
  ('${RECENT}', '${BUYER}', '${SELLER}', 'handed_over', now() - interval '10 days', now() - interval '29 days'),
  ('${NODATES}', '${BUYER}', '${SELLER}', 'handed_over', NULL, NULL),
  ('${BANNED_ORDER}', '${BANNED}', '${SELLER}', 'paid', now(), NULL);
INSERT INTO public.declutter_cart_items (item_id, buyer_id, order_id, created_at) VALUES
  ('${ITEM1}', '${BUYER}', '${ORDER}', now() - interval '1 minute'), ('${ITEM2}', '${BUYER}', '${ORDER}', now());
INSERT INTO public.declutter_bookings VALUES ('${ORDER}', '2026-10-20T15:00:00Z');
INSERT INTO public.jobs (id, customer_id, title, category) VALUES
  ('${JOB}', '${BUYER}', 'Put together a bookshelf', 'assembly'),
  ('${JOB2}', '${BUYER}', 'Hang a TV', 'handyman'),
  ('${CLEANING}', '${BUYER}', 'Clean the den', 'cleaning'),
  ('${OTHERJOB}', '${OTHER}', 'Someone else', 'assembly'),
  ('${ORPHAN}', '${BUYER}', 'Abandoned post', 'assembly'),
  ('${BANNEDJOB}', '${BANNED}', 'Banned post', 'assembly');
INSERT INTO public.jobs (id, customer_id, title, category, payment_status) VALUES
  ('${FUNDED}', '${BUYER}', 'Already paid', 'assembly', 'escrow');
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT DELETE ON public.jobs TO authenticated;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY jobs_read ON public.jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY jobs_delete_own_unpaid ON public.jobs FOR DELETE TO authenticated
  USING (customer_id = auth.uid() AND payment_status = 'unpaid');
`);
await db.exec(readFileSync(DIR + SWITCHES, "utf8"));
// Declutter's own switch (created 'off' by 20261014193955; testers here, as the harness does).
await db.exec("INSERT INTO public.feature_switches (key, audience, description) VALUES ('declutter', 'testers', 'Declutter') ON CONFLICT (key) DO UPDATE SET audience = 'testers';");
// The real ban check, its newest definition verbatim (is_caller_banned reads profiles).
await db.exec(newestDefinition("is_caller_banned").stmt);
// Stage 1 stand-in for declutter_seller_out (slice 3; stage 2 runs the real one): a seller whose profile is not active.
await db.exec(`CREATE FUNCTION public.declutter_seller_out(p_user uuid) RETURNS boolean LANGUAGE sql STABLE
  AS $$ SELECT COALESCE((SELECT p.ban_status <> 'active' FROM public.profiles p WHERE p.user_id = p_user), false) $$;
INSERT INTO public.declutter_orders (id, buyer_id, seller_id, status, paid_at) VALUES ('${SOUT_ORDER}', '${BUYER}', '${BANNED}', 'paid', now());
INSERT INTO public.jobs (id, customer_id, title, category, payment_status) VALUES
  ('${RELINK}', '${BUYER}', 'Retry after a lost answer', 'assembly', 'unpaid'),
  ('${CHARGED}', '${BUYER}', 'Charged back', 'assembly', 'chargeback'),
  ('${SOUTJOB}', '${BUYER}', 'For an out seller', 'assembly', 'unpaid');`);
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

await as(BANNED);
const h15 = await link(BANNED_ORDER, BANNEDJOB);
check("H15 a banned tester is refused the link (account_restricted), nothing linked",
  /account_restricted/.test(h15.err ?? "") && (await linkOf(BANNEDJOB)) === null, JSON.stringify(h15));

await db.exec("RESET ROLE");
await db.exec("UPDATE public.feature_switches SET audience = 'off' WHERE key = 'declutter'");
await as(BUYER);
const h16a = await prefill(ORDER2);
await as(BUYER);
const h16b = await link(ORDER2, JOB2);
await db.exec("RESET ROLE");
await db.exec("UPDATE public.feature_switches SET audience = 'testers' WHERE key = 'declutter'");
check("H16 with Declutter's own switch off, the buyer is refused both calls",
  /feature_disabled/.test(h16a.err ?? "") && /feature_disabled/.test(h16b.err ?? ""), JSON.stringify([h16a, h16b]));

await as(BUYER);
const h17 = await link(ORDER2, FUNDED);
check("H17 the buyer's own open job that is already paid for is refused (job_already_funded)",
  /job_already_funded/.test(h17.err ?? "") && (await linkOf(FUNDED)) === null, JSON.stringify(h17));

await as(BUYER);
const h18a = await q(`SELECT public.declutter_link_setup_job('${ORDER2}', NULL) AS r`);
await as(BUYER);
const h18b = await q(`SELECT public.declutter_link_setup_job(NULL, '${JOB2}') AS r`);
await db.exec("RESET ROLE");
const h18n = await q(`SELECT count(*)::int AS n FROM public.declutter_order_jobs WHERE order_id IS NULL OR job_id IS NULL OR job_id = '${JOB2}'`);
check("H18 NULL arguments never link: a NULL job raises, a NULL order answers false",
  /not your open job/.test(h18a.err ?? "") && h18b.rows?.[0]?.r === false && h18n.rows?.[0]?.n === 1,
  JSON.stringify([h18a, h18b, h18n]));

// H19-H21: the money review of 4f45a073f (LOWs #2-#4).
await as(BUYER);
const h19 = await link(ORDER2, CHARGED);
check("H19 job_already_funded is an ALLOWLIST: a job in any state but unpaid/abandoned/failed (here chargeback) is refused",
  /job_already_funded/.test(h19.err ?? "") && (await linkOf(CHARGED)) === null, JSON.stringify(h19));
await as(BUYER);
const h20a = await link(ORDER2, RELINK);
await db.exec("RESET ROLE");
await db.exec(`UPDATE public.jobs SET payment_status = 'escrow' WHERE id = '${RELINK}'`);
await as(BUYER);
const h20b = await link(ORDER2, RELINK);
await as(BUYER);
const h20c = await link(ORDER, RELINK);
check("H20 a retry re-links a job a gift card funded meanwhile: already linked to THIS order answers yes; another order is still refused",
  h20a.r === true && h20b.r === true && /job_already_funded/.test(h20c.err ?? "") && (await linkOf(RELINK)) === ORDER2,
  JSON.stringify([h20a, h20b, h20c]));
await as(BUYER);
const h21a = await prefill(SOUT_ORDER);
await as(BUYER);
const h21b = await link(SOUT_ORDER, SOUTJOB);
check("H21 a seller who can no longer sell (declutter_seller_out): the order offers nothing and links nothing",
  /item_not_found/.test(h21a.err ?? "") && h21b.r === false && (await linkOf(SOUTJOB)) === null,
  JSON.stringify([h21a, h21b]));

// ---------------------------------------------------------------------------
// Stage 2: the real Declutter schema (slices 1-4, F1, porch, Helpr delivery).
{
  const { setupStatements, liveItemSql, CARDS_SQL, USERS } =
    await import("../../../scripts/declutter/slice3Harness.mjs");
  const R = USERS;
  const db2 = new PGlite();
  await db2.exec(`CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
      file_size_limit bigint, allowed_mime_types text[]);
    INSERT INTO storage.buckets (id, name, public) VALUES ('job-photos', 'job-photos', true);`);
  const extra = STAGE2_EXTRA.map((file) => ({ file, times: 1 }));
  const stmts = setupStatements({ times: 1, times3b: 1, extra });
  // The delivery migration's callees the harness does not create (its own proof stubs them the same way).
  stmts.splice(1, 0, `
    ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
    CREATE TABLE public.user_violations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      violation_type text NOT NULL, description text, job_id uuid, action_taken text, created_at timestamptz DEFAULT now());
    CREATE TABLE public._defects (fn text, ref text, msg text);
    CREATE FUNCTION public.log_cron_defect(p_fn text, p_ref text, p_msg text) RETURNS void LANGUAGE sql
      AS $$ INSERT INTO public._defects VALUES (p_fn, p_ref, p_msg) $$;
    CREATE FUNCTION public.apply_consequence_ladder(p_user uuid, p_violation_type text, p_description text,
      p_job_id uuid, p_prior_count int, p_rungs text[], p_effects text[], p_copy jsonb, p_permanent_requires_review boolean,
      p_suspension_days int, p_clamp_to_worse_status boolean, p_admin_message_format text, p_ban_reason text)
    RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;`);
  for (const sql of stmts) await db2.exec(sql);
  await db2.exec(CARDS_SQL);
  await db2.exec(`
    CREATE TYPE public.job_category AS ENUM ('assembly', 'handyman', 'cleaning');
    CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, title text, category public.job_category NOT NULL,
      status text NOT NULL DEFAULT 'open', payment_status text NOT NULL DEFAULT 'unpaid',
      -- A10: the live columns the seller-fault cancel and the fee debt read and write (information_schema, prod, 2026-10-17).
      helper_id uuid, helper_confirmed_at timestamptz, helper_completed_at timestamptz, is_group_job boolean DEFAULT false, cancelled_by uuid,
      cancelled_at timestamptz, cancellation_reason text, late_cancellation boolean, cancellation_fee numeric,
      cancellation_fee_status text, budget numeric, customer_fee_amount numeric, sales_tax_amount numeric,
      urgent_fee numeric, onboarding_fee_amount numeric,
      parent_job_id uuid, direct_offer_status text, offered_to_helper_id uuid);
    INSERT INTO public.declutter_pickup_windows (seller_id, weekday, starts_local, ends_local)
      SELECT '${R.SELLER}'::uuid, d, '00:00', '23:59' FROM generate_series(0, 6) d;`);
  let applied = 0;
  if (!BEFORE) {
    for (let i = 1; i <= 3; i++) {
      try { await db2.exec(MIGRATION); applied++; } catch (e) { console.log(`stage 2 run ${i}: ${e.message}`); }
    }
  }
  check("P1 the migration applies 3x on the real Declutter schema with Helpr delivery", applied === 3, `${applied}/3`);
  const svc2 = async (sql) => { try { return { rows: (await db2.query(sql)).rows }; } catch (e) { return { err: e.message }; } };
  const as2 = async (uid, sql) => {
    try {
      await db2.exec(`SET request.jwt.claim.sub = '${uid}'; SET ROLE authenticated;`);
      return { rows: (await db2.query(sql)).rows };
    } catch (e) { return { err: e.message }; } finally { await db2.exec("RESET ROLE; RESET request.jwt.claim.sub;"); }
  };
  const I2 = (n) => `77777777-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const paidOrder = async (n, handover) => {
    await db2.exec(liveItemSql({ id: I2(n), seller: R.SELLER, title: `Bookshelf ${n}`, price: 4000, floor: 2000 }));
    await as2(R.BUYER, `SELECT public.declutter_buy_now('${I2(n)}', 4000)`);
    if (handover === "delivery") {
      await svc2(`SELECT public.declutter_set_delivery_dropoff('${R.BUYER}', '${R.SELLER}', '500 Drop Rd, Baton Rouge, LA 70805',
        'North Baton Rouge', 30.496234, -91.154321)`);
    }
    const o = (await as2(R.BUYER, `SELECT * FROM public.declutter_start_checkout('${R.SELLER}', '${handover}')`)).rows?.[0];
    if (!o) return null;
    await svc2(`SELECT public.declutter_mark_order_paid('${o.order_id}', 'pi_aah_${n}', ${o.total_cents}, now(), 150)`);
    return o.order_id;
  };
  const home = await paidOrder(1, "pickup_home");
  const deliv = await paidOrder(2, "delivery");
  const pre = (uid, order) => as2(uid, `SELECT public.declutter_setup_helpr('${order}') AS r`);
  const p2 = await pre(R.BUYER, home);
  check("P2 a real paid pickup order: the buyer's pre-fill names the item",
    p2.rows?.[0]?.r?.status === "paid" && JSON.stringify(p2.rows[0].r.items) === JSON.stringify(["Bookshelf 1"]),
    JSON.stringify(p2));
  const p3 = await pre(R.BUYER, deliv);
  const delivStatus = (await svc2(`SELECT status, handover FROM public.declutter_orders WHERE id = '${deliv}'`)).rows?.[0];
  check("P3 a real paid DELIVERY order is offered too (no booking: pickup time left blank)",
    delivStatus?.status === "paid" && delivStatus?.handover === "delivery"
    && p3.rows?.[0]?.r?.handover === "delivery" && p3.rows[0].r.pickup_at === null,
    JSON.stringify([delivStatus, p3]));
  await svc2(`INSERT INTO public.jobs (id, customer_id, title, category) VALUES ('${I2(50)}', '${R.BUYER}', 'Put it together', 'assembly')`);
  const p4 = await as2(R.BUYER, `SELECT public.declutter_link_setup_job('${deliv}', '${I2(50)}') AS r`);
  check("P4 the buyer links their own job to the delivery order", p4.rows?.[0]?.r === true, JSON.stringify(p4));
  const p5 = await pre(R.SELLER, deliv);
  check("P5 the seller of that order gets no pre-fill (the link is the buyer's)", /item_not_found/.test(p5.err ?? ""), JSON.stringify(p5));
  const p6 = await pre(R.OUTSIDER, deliv);
  check("P6 a non-tester is refused by the switch on the real switch functions", /feature_disabled/.test(p6.err ?? ""), JSON.stringify(p6));

  // ---- A10 (owner rule, 2026-10-17): a seller-fault refund cancels the buyer's setup job, no fee, no strike.
  const HELPR = R.OUTSIDER;
  const job = async (n, extra = {}) => {
    const cols = { id: `'${I2(n)}'`, customer_id: `'${R.BUYER}'`, title: `'Setup ${n}'`, category: "'assembly'",
      status: "'accepted'", payment_status: "'escrow'", helper_id: `'${HELPR}'`, helper_confirmed_at: "now()", budget: 80, customer_fee_amount: 0,
      sales_tax_amount: 0, urgent_fee: 0, onboarding_fee_amount: 2, cancellation_fee: 20, ...extra };
    await svc2(`INSERT INTO public.jobs (${Object.keys(cols).join(", ")}) VALUES (${Object.values(cols).join(", ")})`);
  };
  const linkJob = (n, order) => svc2(`INSERT INTO public.declutter_order_jobs (job_id, order_id, purpose) VALUES ('${I2(n)}', '${order}', 'setup')`);
  const jobRow = async (n) => (await svc2(`SELECT j.status, j.cancellation_fee::float AS fee, j.cancellation_fee_status AS fs,
      j.late_cancellation AS late, j.cancelled_by, l.seller_fault_refund_id AS marker
      FROM public.jobs j LEFT JOIN public.declutter_order_jobs l ON l.job_id = j.id WHERE j.id = '${I2(n)}'`)).rows?.[0];
  const refundOf = async (order, reason) => {
    const pi = (await svc2(`SELECT stripe_payment_intent_id AS pi, total_cents FROM public.declutter_orders WHERE id = '${order}'`)).rows?.[0];
    const r = await svc2(`SELECT public.declutter_record_refund('${order}', '${pi?.pi}', '${reason}', ${pi?.total_cents ?? 0}, 150) AS id`);
    return r.rows?.[0]?.id ?? r.err;
  };
  const defects = async (like) => (await svc2(`SELECT count(*)::int AS n FROM public._defects WHERE msg LIKE '%${like}%'`)).rows?.[0]?.n ?? -1;

  const oA = await paidOrder(3, "pickup_home");
  await job(60); await linkJob(60, oA);
  await job(61, { status: "'completed'", helper_completed_at: "now()" }); await linkJob(61, oA);
  await job(62, { status: "'in_progress'", helper_completed_at: "now()" }); await linkJob(62, oA);
  await job(63, { is_group_job: true, helper_id: "NULL" }); await linkJob(63, oA);
  const refA = await refundOf(oA, "seller_backed_out");
  const a1 = await jobRow(60);
  check("A1 a seller-fault refund cancels the linked live setup job with NO fee, not late, no fee status, and marks it",
    a1?.status === "cancelled" && a1.fee === 0 && a1.fs === null && a1.late === false && a1.cancelled_by === null && a1.marker === refA,
    JSON.stringify([refA, a1]));
  const notes = (await svc2(`SELECT user_id, title FROM public.notifications WHERE link = '/jobs?job=${I2(60)}' ORDER BY user_id`)).rows ?? [];
  check("A2 the buyer and the Helpr are each told once: no fee, the seller backed out",
    notes.length === 2 && notes.some((x) => x.user_id === R.BUYER && /no fee/.test(x.title)) && notes.some((x) => x.user_id === HELPR),
    JSON.stringify(notes));
  const a3a = await jobRow(61), a3b = await jobRow(62);
  check("A3 a completed job, and one the Helpr already marked done, are left alone (no marker); the done one is logged for an admin",
    a3a?.status === "completed" && a3a.marker === null && a3b?.status === "in_progress" && a3b.marker === null
    && (await defects("marked done) of seller-fault")) === 1,
    JSON.stringify([a3a, a3b]));
  const a4 = await jobRow(63);
  check("A4 a crew setup job is left for an admin and logged", a4?.status === "accepted" && a4.marker === null && (await defects("crew setup job")) === 1,
    JSON.stringify(a4));

  const oB = await paidOrder(4, "pickup_home");
  await job(64); await linkJob(64, oB);
  const refB = await refundOf(oB, "buyer_cancelled");
  const a5 = await jobRow(64);
  check("A5 a refund that is NOT the seller's fault (buyer_cancelled) leaves the setup job untouched",
    typeof refB === "string" && /^[0-9a-f-]{36}$/.test(refB) && a5?.status === "accepted" && a5.marker === null, JSON.stringify([refB, a5]));

  const oC = await paidOrder(5, "pickup_home");
  await job(65); await linkJob(65, oC);
  await db2.exec(`CREATE FUNCTION public._boom() RETURNS trigger LANGUAGE plpgsql AS $b$ BEGIN RAISE EXCEPTION 'boom'; END $b$;
    CREATE TRIGGER _boom BEFORE UPDATE ON public.jobs FOR EACH ROW WHEN (OLD.id = '${I2(65)}') EXECUTE FUNCTION public._boom();`);
  const refC = await refundOf(oC, "seller_out");
  const a6 = await jobRow(65);
  const refCRow = (await svc2(`SELECT count(*)::int AS n FROM public.declutter_refunds WHERE id = '${refC}'`)).rows?.[0]?.n;
  check("A6 the refund write is never blocked: a failing cancel is logged, the refund row lands, the job is left as it was",
    refCRow === 1 && a6?.status === "accepted" && a6.marker === null && (await defects("could not cancel setup job")) === 1,
    JSON.stringify([refC, refCRow, a6]));
  await svc2("DROP TRIGGER _boom ON public.jobs");

  // The seller's debt for the job's card fee.
  const debt = async (ref) => (await svc2(`SELECT amount_cents, remaining_cents FROM public.declutter_seller_fee_debts WHERE refund_id = '${ref}'`)).rows?.[0] ?? null;
  const before = await debt(refA);
  const bill = (n, c) => svc2(`SELECT public.declutter_setup_job_fee_debt('${I2(n)}', ${c}) AS r`);
  const a7a = await bill(60, 263);
  const after1 = await debt(refA);
  const a7b = await bill(60, 263);
  const after2 = await debt(refA);
  check("A7 the job's card fee is added to the seller's debt for that refund, once (a re-run bills 0)",
    before?.amount_cents === 150 && a7a.rows?.[0]?.r === 263 && after1?.amount_cents === 413 && after1.remaining_cents === 413
    && a7b.rows?.[0]?.r === 0 && after2?.amount_cents === 413,
    JSON.stringify([before, a7a, after1, a7b, after2]));
  const a8a = await bill(64, 100), a8b = await bill(60, -1), a8c = await svc2(`SELECT public.declutter_setup_job_fee_debt('${I2(60)}', NULL) AS r`);
  check("A8 a job no seller-fault refund cancelled is refused (not_seller_fault); a NULL or negative fee is refused (invalid_fee)",
    /not_seller_fault/.test(a8a.err ?? "") && /invalid_fee/.test(a8b.err ?? "") && /invalid_fee/.test(a8c.err ?? ""),
    JSON.stringify([a8a, a8b, a8c]));
  const oD = await paidOrder(6, "pickup_home");
  await job(66, { budget: 1 , onboarding_fee_amount: 0 }); await linkJob(66, oD);
  const refD = await refundOf(oD, "not_as_described");
  const a9 = await bill(66, 99999);
  check("A9 the debt is never more than the job's whole charge ($1 job: at most 100 cents)",
    a9.rows?.[0]?.r === 100 && (await debt(refD))?.amount_cents === 250, JSON.stringify([refD, a9, await debt(refD)]));
  const a10 = await as2(R.SELLER, `SELECT public.declutter_setup_job_fee_debt('${I2(60)}', 1) AS r`);
  const a10b = await as2(R.BUYER, `SELECT public.declutter_refund_cancels_setup_jobs()`);
  check("A10 a signed-in member cannot call the debt function or the trigger function",
    /permission denied/.test(a10.err ?? "") && /permission denied|trigger functions can only be called/.test(a10b.err ?? ""),
    JSON.stringify([a10, a10b]));

  // A11-A13 through the REAL buyer entry (lh-authz-rls review of c57d948d0 #1, #4): a seller no-show is
  // asserted by the buyer alone (declutter_report_no_show), so it never cancels a COMMITTED job fee-free.
  const noShowOrder = async (n) => {
    const o = await paidOrder(n, "pickup_home");
    await svc2(`INSERT INTO public.declutter_bookings (order_id, buyer_id, seller_id, slot_start, slot_end)
      VALUES ('${o}', '${R.BUYER}', '${R.SELLER}', now() - interval '1 hour', now() - interval '30 minutes')`);
    return o;
  };
  const oE = await noShowOrder(7);
  await job(67, { status: "'in_progress'" }); await linkJob(67, oE);
  await job(68, { status: "'open'", helper_id: "NULL", helper_confirmed_at: "NULL", payment_status: "'unpaid'" }); await linkJob(68, oE);
  await job(69, { helper_confirmed_at: "NULL" }); await linkJob(69, oE);
  const ns = await as2(R.BUYER, `SELECT public.declutter_report_no_show('${oE}') AS r`);
  const ref = (await svc2(`SELECT reason, fee_policy FROM public.declutter_refunds WHERE order_id = '${oE}'`)).rows?.[0];
  const a11 = await jobRow(67);
  check("A11 the buyer's own seller-no-show report never cancels a COMMITTED (hired + confirmed) setup job fee-free: left for an admin, logged",
    !ns.err && ref?.reason === "seller_no_show" && ref.fee_policy === "full_seller_pays_fee"
    && a11?.status === "in_progress" && a11.marker === null && (await defects("committed Helpr")) === 1
    && (await svc2(`SELECT count(*)::int AS n FROM public.notifications WHERE link = '/jobs?job=${I2(67)}' AND title = 'Your Helpr job is still booked'`)).rows?.[0]?.n === 1,
    JSON.stringify([ns, ref, a11]));
  const a12a = await jobRow(68), a12b = await jobRow(69);
  check("A12 on that same report, an open job and a hired-but-unconfirmed one (no fee under the normal rules) are cancelled and marked",
    a12a?.status === "cancelled" && a12a.marker !== null && a12b?.status === "cancelled" && a12b.fee === 0 && a12b.marker !== null,
    JSON.stringify([a12a, a12b]));
  const oF = await paidOrder(8, "pickup_home");
  await job(70); await job(71); await linkJob(70, oF); await linkJob(71, oF);
  await db2.exec(`CREATE FUNCTION public._boom2() RETURNS trigger LANGUAGE plpgsql AS $b$ BEGIN RAISE EXCEPTION 'boom2'; END $b$;
    CREATE TRIGGER _boom2 BEFORE UPDATE ON public.jobs FOR EACH ROW WHEN (OLD.id = '${I2(70)}') EXECUTE FUNCTION public._boom2();`);
  await refundOf(oF, "seller_backed_out");
  await db2.exec("DROP TRIGGER _boom2 ON public.jobs");
  const a13a = await jobRow(70), a13b = await jobRow(71);
  check("A13 one job that cannot be cancelled never undoes another's cancel on the same refund (per-job sub-block)",
    a13a?.status === "accepted" && a13a.marker === null && a13b?.status === "cancelled" && a13b.marker !== null,
    JSON.stringify([a13a, a13b]));

  // A16-A18: the admin's hand tool (lh-money-escrow review of c57d948d0 #2) and the money-at-rest rule (#7).
  const refE = (await svc2(`SELECT id FROM public.declutter_refunds WHERE order_id = '${oE}'`)).rows?.[0]?.id;
  const a16no = await as2(R.BUYER, `SELECT public.declutter_admin_apply_seller_fault('${refE}', true) AS n`);
  const a16 = await as2(R.ADMIN, `SELECT public.declutter_admin_apply_seller_fault('${refE}', true) AS n`);
  const a16again = await as2(R.ADMIN, `SELECT public.declutter_admin_apply_seller_fault('${refE}', true) AS n`);
  const a16job = await jobRow(67);
  const audit = (await svc2(`SELECT count(*)::int AS n FROM public.admin_audit_log WHERE action = 'declutter_apply_seller_fault' AND target_id = '${refE}'`)).rows?.[0]?.n;
  check("A16 an admin applies A10 by hand to the committed no-show job (once: a re-run cancels 0), audited; the buyer is refused",
    /not_authorized/.test(a16no.err ?? "") && a16.rows?.[0]?.n === 1 && a16again.rows?.[0]?.n === 0
    && a16job?.status === "cancelled" && a16job.fee === 0 && a16job.marker === refE && audit === 2,
    JSON.stringify([a16no, a16, a16again, a16job, audit]));
  const a17 = await as2(R.ADMIN, `SELECT public.declutter_admin_apply_seller_fault('${refB}', false) AS n`);
  check("A17 the hand tool refuses a refund that is not the seller's fault (not_seller_fault)", /not_seller_fault/.test(a17.err ?? ""), JSON.stringify(a17));
  const refGone = (await svc2(`SELECT id FROM public.declutter_refunds WHERE order_id = '${oF}'`)).rows?.[0]?.id;
  await svc2(`UPDATE public.declutter_refunds SET order_id = NULL WHERE id = '${refGone}'`);
  const a17b = await as2(R.ADMIN, `SELECT public.declutter_admin_apply_seller_fault('${refGone}', false) AS n`);
  check("A17b a refund whose order is gone is refused out loud (order_gone), never a silent 0",
    /order_gone/.test(a17b.err ?? ""), JSON.stringify([refGone, a17b]));
  const oH = await paidOrder(10, "pickup_home");
  await job(74, { payment_status: "'cancelling'" }); await linkJob(74, oH);
  await refundOf(oH, "seller_backed_out");
  const a18 = await jobRow(74);
  check("A18 a job whose money is not at rest (payment 'cancelling') is left for an admin and logged",
    a18?.status === "accepted" && a18.marker === null && (await defects("(payment cancelling)")) === 1, JSON.stringify(a18));

  // A14: the marker outlives the order (a seller's account deletion cascades their orders; review #1).
  const a14ref = (await jobRow(60))?.marker;
  await svc2(`DELETE FROM public.declutter_orders WHERE id = '${oA}'`);
  const a14 = await svc2(`SELECT order_id, seller_fault_refund_id AS marker FROM public.declutter_order_jobs WHERE job_id = '${I2(60)}'`);
  check("A14 the seller-fault marker survives the order being deleted (order_id SET NULL, never CASCADE)",
    a14ref && a14.rows?.length === 1 && a14.rows[0].order_id === null && a14.rows[0].marker === a14ref, JSON.stringify([a14ref, a14]));

  // A15: the Helpr's back-out email is the REAL record_backout_notice (as restated here), on the jobs stub.
  // Without the migration (--before) record_backout_notice does not exist: the check below fails, never throws.
  await db2.exec(`
    CREATE TABLE public.backout_notices (job_id uuid, user_id uuid, actor_name text, backout_kind text);
    CREATE FUNCTION public.backout_notice_text(p_kind text, p_name text, p_title text, OUT title text, OUT message text)
      LANGUAGE sql AS $b$ SELECT 'Back out'::text, coalesce(p_name, '?') || ' cancelled' $b$;
    CREATE FUNCTION public.send_backout_email(p_user uuid, p_job uuid, p_title text, p_message text, p_link text)
      RETURNS void LANGUAGE sql AS $b$ SELECT NULL::void $b$;
`);
  await db2.exec(`CREATE TRIGGER trg_jobs_record_backout_notice AFTER UPDATE ON public.jobs FOR EACH ROW
      EXECUTE FUNCTION public.record_backout_notice();`).catch((e) => console.log(`A15 setup: ${e.message}`));
  const oG = await paidOrder(9, "pickup_home");
  await job(72); await linkJob(72, oG);
  await job(73);
  await refundOf(oG, "seller_backed_out");
  await svc2(`UPDATE public.jobs SET status = 'cancelled' WHERE id = '${I2(73)}'`);
  const bo = (await svc2(`SELECT job_id, backout_kind FROM public.backout_notices ORDER BY job_id`)).rows ?? [];
  check("A15 A10's cancel sends no 'the poster cancelled' back-out email (a poster's own cancel still does)",
    (await jobRow(72))?.status === "cancelled" && bo.length === 1 && bo[0].job_id === I2(73) && bo[0].backout_kind === "poster_cancelled",
    JSON.stringify(bo));
}

const expected = 46;
console.log(`\n${checks - failures}/${checks} passed (expected ${expected} checks)`);
if (INVERT) {
  process.exit(failures === checks && checks === expected ? 0 : 1);
}
process.exit(failures === 0 && checks === expected ? 0 : 1);

