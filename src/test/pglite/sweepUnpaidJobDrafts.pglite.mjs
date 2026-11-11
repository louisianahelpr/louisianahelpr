#!/usr/bin/env node
/**
 * PGlite proof for F300's sweep (owner 2026-11-11: auto-delete unpaid drafts after 24 h): a never-paid job untouched
 * for 24 hours is deleted; a paid job, one with a payment intent, a fresh one, a hired, offered, repeating or
 * visit job, one with an application, a card hold, a gift card or a live checkout session, and one a foreign key
 * still protects are all kept. Only
 * service_role may run it; the cron is scheduled by name.
 *
 *   node src/test/pglite/sweepUnpaidJobDrafts.pglite.mjs                    # AFTER: migration applied 3x
 *   NEW_MIGRATION=skip node src/test/pglite/sweepUnpaidJobDrafts.pglite.mjs # RED: before it
 *
 * Stubs: a jobs table with the columns the sweep reads, applications, job_card_holds, gift_cards, a RESTRICT child (a protected
 * row), cron.schedule and cron_record_work. pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite.
 */
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const FILE = readdirSync(MIG).find((f) => f.endsWith("_sweep_unpaid_job_drafts.sql"));
const NEW = readFileSync(MIG + FILE, "utf8");
const SKIP = process.env.NEW_MIGRATION === "skip";
if (SKIP) console.log("NEW_MIGRATION=skip: before the migration (expect FAILs)");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA cron;
  CREATE TABLE cron.jobs (name text PRIMARY KEY, schedule text, command text);
  CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO cron.jobs VALUES (n, s, c) ON CONFLICT (name) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command; RETURN 1; END $$;
  CREATE TABLE public.cron_work_expectations (jobname text PRIMARY KEY, expected_max_gap interval, note text, work_visibility text, work_exempt_reason text);
  CREATE FUNCTION public.cron_record_work(p_job text, p_result jsonb) RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE TABLE public.jobs (
    id uuid PRIMARY KEY, title text, payment_status text, stripe_payment_intent_id text,
    created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
    helper_id uuid, offered_to_helper_id uuid, parent_job_id uuid REFERENCES public.jobs (id), is_recurring boolean,
    stripe_session_id text);
  CREATE TABLE public.applications (id serial PRIMARY KEY, job_id uuid REFERENCES public.jobs (id) ON DELETE CASCADE);
  CREATE TABLE public.job_card_holds (id serial PRIMARY KEY, job_id uuid REFERENCES public.jobs (id) ON DELETE CASCADE);
  CREATE TABLE public.gift_cards (id serial PRIMARY KEY, job_id uuid REFERENCES public.jobs (id));
  CREATE TABLE public.protected_child (id serial PRIMARY KEY, job_id uuid REFERENCES public.jobs (id) ON DELETE RESTRICT);
`);

const NOW = "2026-11-11T18:00:00Z";
const OLD = "2026-11-10T16:00:00Z"; // 26 h before NOW
const FRESH = "2026-11-10T19:00:00Z"; // 23 h before NOW
const id = (n) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const rows = [
  // [n, title, payment_status, pi, created, updated, helper, offered, parent, recurring]
  [1, "unpaid old", "unpaid", null, OLD, OLD],
  [2, "abandoned old", "abandoned", null, OLD, OLD],
  [3, "failed old, no intent", "failed", null, OLD, OLD],
  [4, "paid (escrow)", "escrow", "pi_1", OLD, OLD],
  [5, "unpaid but has an intent", "unpaid", "pi_2", OLD, OLD],
  [6, "unpaid fresh", "unpaid", null, FRESH, FRESH],
  [7, "unpaid old, touched recently", "unpaid", null, OLD, FRESH],
  [8, "unpaid old, hired", "unpaid", null, OLD, OLD, id(90)],
  [9, "unpaid old, offered", "unpaid", null, OLD, OLD, null, id(91)],
  [10, "unpaid old, repeating", "unpaid", null, OLD, OLD, null, null, null, true],
  [11, "unpaid old, has application", "unpaid", null, OLD, OLD],
  [12, "unpaid old, has card hold", "unpaid", null, OLD, OLD],
  [13, "unpaid old, protected by FK", "unpaid", null, OLD, OLD],
  [14, "unpaid old, a visit of #4", "unpaid", null, OLD, OLD, null, null, id(4)],
  [15, "held (card hold mode)", "held", null, OLD, OLD],
  [16, "unpaid old, parent of a visit", "unpaid", null, OLD, OLD],
  [17, "visit of #16 (paid)", "escrow", "pi_3", OLD, OLD, null, null, id(16)],
  // lh-money-escrow review 11-11: a session still stamped on an unpaid/failed job is a checkout that may have been
  // paid with its webhook not landed (expiry clears it); 'abandoned' is the expiry Stripe confirmed.
  [18, "unpaid old, checkout session still stamped", "unpaid", null, OLD, OLD, null, null, null, null, "cs_live"],
  [19, "failed old, checkout session still stamped", "failed", null, OLD, OLD, null, null, null, null, "cs_failed"],
  [20, "abandoned old, expired session stamped", "abandoned", null, OLD, OLD, null, null, null, null, "cs_expired"],
  [21, "unpaid old, a gift card reserved for it", "unpaid", null, OLD, OLD],
];
for (const [n, title, ps, pi, c, u, h = null, o = null, p = null, r = null, sess = null] of rows) {
  await db.query(
    "INSERT INTO public.jobs VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [id(n), title, ps, pi, c, u, h, o, p, r, sess],
  );
}
await db.query("INSERT INTO public.applications (job_id) VALUES ($1)", [id(11)]);
await db.query("INSERT INTO public.job_card_holds (job_id) VALUES ($1)", [id(12)]);
await db.query("INSERT INTO public.protected_child (job_id) VALUES ($1)", [id(13)]);
await db.query("INSERT INTO public.gift_cards (job_id) VALUES ($1)", [id(21)]);

const exists = async (n) => (await db.query("SELECT 1 FROM public.jobs WHERE id = $1", [id(n)])).rows.length === 1;

if (!SKIP) for (let i = 0; i < 3; i++) await db.exec(NEW);
const hasFn = (await db.query("SELECT to_regprocedure('public.sweep_unpaid_job_drafts(timestamptz)') IS NOT NULL AS ok")).rows[0].ok;
check("the sweep function exists", hasFn);

if (hasFn) {
  const res = (await db.query("SELECT public.sweep_unpaid_job_drafts($1::timestamptz) AS r", [NOW])).rows[0].r;
  // The gift-card job is excluded by the SELECT, not skipped per row: skipped stays 1 (only the RESTRICT child).
  check("one run deletes 4 and skips only the FK-protected one", res.deleted === 4 && res.skipped === 1, JSON.stringify(res));
  for (const n of [1, 2, 3, 20]) check(`deleted: ${rows[n - 1][1]}`, !(await exists(n)));
  for (const n of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21]) check(`kept: ${rows[n - 1][1]}`, await exists(n));
  const again = (await db.query("SELECT public.sweep_unpaid_job_drafts($1::timestamptz) AS r", [NOW])).rows[0].r;
  check("a second run deletes nothing more", again.deleted === 0, JSON.stringify(again));
  const acl = (await db.query("SELECT proacl::text AS a FROM pg_proc WHERE proname = 'sweep_unpaid_job_drafts'")).rows[0].a ?? "";
  check("only service_role may run it (no PUBLIC, anon or authenticated)", /service_role=X/.test(acl) && !/(^|[{,])=X/.test(acl) && !/anon=X/.test(acl) && !/authenticated=X/.test(acl), acl);
}
const cronRow = (await db.query("SELECT schedule, command FROM cron.jobs WHERE name = 'unpaid-job-draft-sweep'")).rows[0];
check("the cron is scheduled hourly by name", cronRow?.schedule === "38 * * * *" && /sweep_unpaid_job_drafts\(\)/.test(cronRow?.command ?? ""), JSON.stringify(cronRow ?? null));
const exp = (await db.query("SELECT 1 FROM public.cron_work_expectations WHERE jobname = 'unpaid-job-draft-sweep'")).rows.length;
check("the cron has a work expectation", exp === 1);

// The 24-hour edge on the real clock read (no p_now): the newest definition, its now() pointed at a fixed clock.
// Exactly 24 h untouched is kept (strict <); 24 h and 1 ms is deleted. Both created_at and updated_at sit on the edge.
if (hasFn) {
  await installClock(db);
  await db.exec(onFixedClock(newestFunction("sweep_unpaid_job_drafts").stmt));
  const CLOCK = "2026-11-12T12:00:00.000Z";
  await db.query("INSERT INTO public.jobs VALUES ($1,'edge 24h','unpaid',NULL,$2,$2,NULL,NULL,NULL,NULL)", [id(40), "2026-11-11T12:00:00.000Z"]);
  await db.query("INSERT INTO public.jobs VALUES ($1,'edge 24h+1ms','unpaid',NULL,$2,$2,NULL,NULL,NULL,NULL)", [id(41), "2026-11-11T11:59:59.999Z"]);
  await setClock(db, CLOCK);
  await db.query("SELECT public.sweep_unpaid_job_drafts()");
  check("fixed clock: untouched exactly 24 h is kept", await exists(40));
  check("fixed clock: untouched 24 h and 1 ms is deleted", !(await exists(41)));
}

console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
