#!/usr/bin/env node
/**
 * PGlite proof for 20261102050858_declutter_haul_away_relink_touches_the_link (Q2418): a same-job haul-away re-link
 * (Post a Job's retry of the payment hand-off) touches the link rows' updated_at, so declutter_haul_away_sweep Part C
 * (which undoes only a link untouched for 7 days) never puts the items back on sale under a retry about to pay.
 *
 *   node src/test/pglite/declutterHaulAwayRelinkTouches.pglite.mjs                    # applied 3x: all PASS
 *   NEW_MIGRATION=skip node src/test/pglite/declutterHaulAwayRelinkTouches.pglite.mjs # RED: the 20261028223036 version
 *   MUTANT=<name> node src/test/pglite/declutterHaulAwayRelinkTouches.pglite.mjs      # a planted defect: must FAIL
 *
 * Stubbed, said so: the tables the function reads reduced to their columns (declutter_items, jobs,
 * declutter_haul_aways, declutter_item_private, declutter_cart_items, declutter_offers, declutter_offer_events);
 * require_feature, is_caller_banned, declutter_notify and declutter_haul_job_hold as no-op / fixed answers;
 * auth.uid() from request.jwt.claim.sub. Part C's freshness test is the sweep's own line, quoted:
 * "v_link.updated_at > now() - interval '7 days'" -> skip. The function is called as the seller (authenticated);
 * Supabase's default anon/authenticated EXECUTE grant on new functions is emulated.
 */
import os from "node:os";
import { readFileSync } from "node:fs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG_DIR = new URL("../../../supabase/migrations/", import.meta.url).pathname;
const THIS = "20261102050858_declutter_haul_away_relink_touches_the_link.sql";
const BEFORE = "20261028223036_declutter_notice_links_open_the_right_tab.sql";
const MUTANT = process.env.MUTANT ?? "";
const MUTANTS = {
  // The early-return re-link writes nothing again.
  noTouch: ["    UPDATE public.declutter_haul_aways SET updated_at = now() WHERE item_id = ANY (v_ids) AND job_id = p_job_id;\n", ""],
  // It touches every link of the seller's items, not only this job's.
  // The partial re-link (one item already on this job, one new) leaves the old link untouched.
  noLoopTouch: ["        UPDATE public.declutter_haul_aways SET updated_at = now() WHERE item_id = v_item.id;\n        CONTINUE;  -- this same post", "        CONTINUE;  -- this same post"],
  touchOthers: ["SET updated_at = now() WHERE item_id = ANY (v_ids) AND job_id = p_job_id;", "SET updated_at = now() WHERE job_id IS NOT NULL;"],
};
const skip = process.env.NEW_MIGRATION === "skip";

let failures = 0;
const check = (ok, name) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); if (!ok) failures++; };
const U = (n) => `eeeeeeee-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SELLER = U(1), OTHER = U(2), JOB = U(10), JOB2 = U(11), ITEM = U(20), ITEM2 = U(21), ITEM3 = U(22), ITEM4 = U(23);

/** The newest definition before this migration (20261028223036), with its grants. */
function before() {
  const sql = readFileSync(MIG_DIR + BEFORE, "utf8");
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.declutter_link_haul_away(");
  const end = sql.indexOf("GRANT EXECUTE ON FUNCTION public.declutter_link_haul_away(uuid[], uuid) TO authenticated, service_role;", start);
  return sql.slice(start, end) + "GRANT EXECUTE ON FUNCTION public.declutter_link_haul_away(uuid[], uuid) TO authenticated, service_role;";
}

const db = new PGlite();
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION public.require_feature(text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.is_caller_banned() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.declutter_notify(uuid, text, text, text, text, uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.declutter_haul_job_hold(uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'none' $$;
CREATE TABLE public.declutter_items (id uuid PRIMARY KEY, seller_id uuid, status text, title text, live_at timestamptz,
  submitted_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, customer_id uuid, status text, payment_status text);
CREATE TABLE public.declutter_haul_aways (item_id uuid PRIMARY KEY, job_id uuid, prior_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.declutter_item_private (item_id uuid, seller_id uuid, pickup_address text);
CREATE TABLE public.declutter_cart_items (item_id uuid, status text);
CREATE TABLE public.declutter_offers (id uuid PRIMARY KEY, item_id uuid, buyer_id uuid, status text, closed_at timestamptz, updated_at timestamptz);
CREATE TABLE public.declutter_offer_events (offer_id uuid, actor_side text, action text);
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
`);
const q = async (s, p = []) => (await db.query(s, p)).rows;
await q(`INSERT INTO public.declutter_items (id, seller_id, status, title) VALUES ($1, $3, 'ended', 'Desk'), ($2, $3, 'ended', 'Lamp'),
  ($4, $3, 'ended', 'Rug'), ($5, $3, 'ended', 'Chair')`, [ITEM, ITEM2, SELLER, ITEM3, ITEM4]);
await q(`INSERT INTO public.jobs VALUES ($1, $3, 'open', 'abandoned'), ($2, $3, 'open', 'abandoned')`, [JOB, JOB2, SELLER]);
// Linked 8 days ago (the sweep's 7-day line has passed); a third item on another job, also old.
await q(`INSERT INTO public.declutter_haul_aways (item_id, job_id, prior_status, updated_at) VALUES
  ($1, $3, 'live', now() - interval '8 days'), ($2, $3, 'live', now() - interval '8 days'),
  ($4, $5, 'live', now() - interval '8 days')`, [ITEM, ITEM2, JOB, ITEM3, JOB2]);

await db.exec(before());
if (!skip) {
  let mig = readFileSync(MIG_DIR + THIS, "utf8");
  if (MUTANT) {
    const m = MUTANTS[MUTANT];
    if (!m || !mig.includes(m[0])) throw new Error(`mutant ${MUTANT} did not apply`);
    mig = mig.replace(m[0], m[1]);
  }
  for (let k = 1; k <= 3; k++) {
    try { await db.exec(mig); check(true, `the migration applies (run ${k})`); } catch (e) { check(false, `the migration applies (run ${k}): ${e.message}`); }
  }
}

const relink = async (uid, items, job) => {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${uid}', false); SET ROLE authenticated;`);
  try { return await q(`SELECT public.declutter_link_haul_away($1::uuid[], $2) AS n`, [items, job]); }
  catch (e) { return { error: e.message }; }
  finally { await db.exec("RESET ROLE"); }
};
// The sweep's Part C freshness test, verbatim: a link updated in the last 7 days is skipped.
const sweepSkips = async (item) => (await q(`SELECT (h.updated_at > now() - interval '7 days') AS fresh
  FROM public.declutter_haul_aways h WHERE h.item_id = $1`, [item]))[0]?.fresh === true;

check(!(await sweepSkips(ITEM)), "before the retry, the 8-day-old link is one the sweep would undo");
const r = await relink(SELLER, [ITEM, ITEM2], JOB);
check(!r.error && r[0]?.n === 2, `the same-job re-link answers success (${r.error ?? r[0]?.n})`);
check(await sweepSkips(ITEM) && await sweepSkips(ITEM2), "[fix] after the retry's re-link, the sweep skips both links (touched)");
check(!(await sweepSkips(ITEM3)), "[fix] another job's link is not touched");
const items = await q(`SELECT status FROM public.declutter_items WHERE id = ANY($1::uuid[])`, [[ITEM, ITEM2]]);
check(items.every((x) => x.status === "ended"), "the items stay off sale");
// A partial re-link: the Rug is already on JOB2, the Chair is new; the Rug's link is touched too.
const part = await relink(SELLER, [ITEM3, ITEM4], JOB2);
check(!part.error, `a re-link adding one more item works (${part.error ?? "ok"})`);
check(await sweepSkips(ITEM3), "[fix] the item already on that job is touched on a partial re-link");
const stranger = await relink(OTHER, [ITEM], JOB);
check(!!stranger.error, `another member cannot re-link the seller's items (${(stranger.error ?? "allowed").slice(0, 40)})`);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
