/**
 * Q1424 PGlite proof: helpr_task_sweep's clock windows (Declutter Helpr delivery), on a fixed clock
 * (./lib/fixedClock.mjs, newest CREATE of the function). declutterDelivery.pglite.mjs moves open_until /
 * pickup_slot_start / delivered_at relative to now(); this one moves the clock and reads each edge 1 ms either side:
 *   seller's report   seller_no_show_answer_by <= now: unanswered, settled (strike, reopened) exactly at the deadline
 *   unfilled          open_until <= now: closed exactly then
 *   Helpr no-show     pickup_slot_start + 2 h <= now: reopened with a strike exactly 2 h after the pickup time
 *   auto-confirm      delivered_at + 24 h <= now: confirmed exactly 24 h after delivery
 *   still in hand     picked_up_at + 24 h <= now, then again only when in_hand_nudged_at + 7 days <= now
 *   can't finish      waiting_fix: stuck_fix_by <= now moves it to 'returning', due back 48 h from the clock
 * none of them 1 ms early.
 *
 *   node src/test/pglite/helprTaskSweepClock.pglite.mjs
 *   TASK_NOSHOW_STRICT=1 ...     # RED: the 2 h no-show edge made strict (both reads)
 *   TASK_CONFIRM_STRICT=1 ...    # RED: the 24 h auto-confirm edge made strict (both reads)
 *   TASK_NUDGE_STRICT=1 ...      # RED: the weekly re-nudge edge made strict (both reads)
 *
 * The task helpers (lock, close, reopen, strike, source events, notices) have their own proofs and are stubbed to
 * record the call. pglite is loaded from ~/.lh-pglite (CLAUDE.md). Registered in src/test/clockFunctionsProven.test.ts.
 */
import os from "node:os";
import { installClock, newestFunction, onFixedClock, setClock } from "./lib/fixedClock.mjs";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
await installClock(db);
await db.exec(`
SET TIME ZONE 'UTC';
CREATE ROLE service_role;
CREATE ROLE authenticated;
CREATE ROLE anon;
CREATE TABLE public.helpr_tasks (
  id int PRIMARY KEY, status text, source_kind text DEFAULT 'declutter_order', source_id uuid DEFAULT gen_random_uuid(),
  helpr_id uuid DEFAULT gen_random_uuid(), customer_id uuid DEFAULT gen_random_uuid(), pickup_contact_id uuid DEFAULT gen_random_uuid(),
  title text DEFAULT 'Oak chair', is_seed boolean DEFAULT false,
  seller_no_show_answer_by timestamptz, seller_no_show_answered_at timestamptz, seller_no_show_settled_at timestamptz,
  open_until timestamptz, pickup_slot_start timestamptz, delivered_at timestamptz, picked_up_at timestamptz,
  in_hand_nudged_at timestamptz, stuck_stage text, stuck_fix_by timestamptz, return_answer_by timestamptz,
  stuck_return_by timestamptz, stuck_choice_by timestamptz, updated_at timestamptz);
CREATE TABLE public.declutter_problems (order_id uuid, status text, reporter_id uuid, reporter_side text, reason text, note text, photo_paths text[]);
CREATE TABLE public.declutter_orders (id uuid PRIMARY KEY);
CREATE TABLE public.test_accounts (user_id uuid);
CREATE TABLE public.profiles (user_id uuid, is_seed boolean);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.calls (what text);
CREATE FUNCTION public.helpr_task_lock(p int) RETURNS public.helpr_tasks LANGUAGE sql AS $$ SELECT * FROM public.helpr_tasks WHERE id = p $$;
CREATE FUNCTION public.helpr_task_source_held(k text, s uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.helpr_task_give_job_strike(u uuid, why text, t int, words text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('strike:' || why) $$;
CREATE FUNCTION public.helpr_task_reopen(t int, why text, u uuid, words text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('reopen:' || why) $$;
CREATE FUNCTION public.helpr_task_close(t int, why text, words text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('close:' || why) $$;
CREATE FUNCTION public.helpr_task_source_event(t int, ev text, how text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('event:' || ev) $$;
CREATE FUNCTION public.declutter_notify(p_user uuid, p_type text, p_title text, p_body text, p_link text, p_other uuid DEFAULT NULL) RETURNS void
  LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('notify:' || p_title) $$;
CREATE FUNCTION public.declutter_delivery_return_finish(t int) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('return_finish') $$;
CREATE FUNCTION public.is_test_subject(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.log_cron_defect(a text, b text, c text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.calls VALUES ('defect:' || c) $$;
`);
const { file, stmt } = newestFunction("helpr_task_sweep");
const base = onFixedClock(stmt);
let fixed = base;
check(`every clock read is on the fixed clock (${file})`, !/\bnow\s*\(\s*\)/i.test(fixed) && /_probe_now\(\)/.test(fixed));
const mutations = {
  TASK_NOSHOW_STRICT: ["pickup_slot_start + interval '2 hours' <= public._probe_now()", "pickup_slot_start + interval '2 hours' < public._probe_now()"],
  TASK_CONFIRM_STRICT: ["delivered_at + interval '24 hours' <= public._probe_now()", "delivered_at + interval '24 hours' < public._probe_now()"],
  TASK_NUDGE_STRICT: ["in_hand_nudged_at + interval '7 days' <= public._probe_now()", "in_hand_nudged_at + interval '7 days' < public._probe_now()"],
};
let mutated = false;
for (const [env, [from, to]] of Object.entries(mutations)) {
  if (!process.env[env]) continue;
  console.log(`${env}=1 (expect FAILs)`);
  check(`${env}: the text to change is in the newest body`, fixed.includes(from));
  fixed = fixed.split(from).join(to);
  mutated = true;
}
check("the mutation (if any) applied", !mutated || fixed !== base);
// Replay-safe: applies 3x.
for (let i = 0; i < 3; i++) await db.exec(fixed);

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const H = 3_600_000;
const D = 24 * H;
const task = async (cols) => {
  await db.exec(`DELETE FROM public.calls; DELETE FROM public.helpr_tasks;`);
  const keys = Object.keys(cols);
  await q(`INSERT INTO public.helpr_tasks (id, ${keys.join(", ")}) VALUES (1, ${keys.map((_, i) => `$${i + 1}`).join(", ")})`,
    keys.map((k) => (typeof cols[k] === "number" ? iso(cols[k]) : cols[k])));
};
const sweep = async (nowMs) => {
  await setClock(db, iso(nowMs));
  const r = (await q(`SELECT public.helpr_task_sweep() AS r`))[0].r;
  const calls = (await q(`SELECT what FROM public.calls`)).map((c) => c.what);
  const [t] = await q(`SELECT stuck_stage, stuck_return_by::text rb, in_hand_nudged_at::text nudged, seller_no_show_settled_at::text settled FROM public.helpr_tasks`);
  return { r, calls, t };
};
const N = Date.UTC(2026, 6, 15, 20, 0, 0);
const edge = async (name, cols, edgeMs, ok) => {
  await task(cols);
  const early = await sweep(edgeMs - 1);
  check(`${name}: 1 ms before: nothing`, early.calls.length === 0, JSON.stringify(early));
  await task(cols);
  const at = await sweep(edgeMs);
  check(`${name}: at the edge`, ok(at), JSON.stringify(at));
  return at;
};

await edge("seller's no-show report unanswered", { status: "accepted", seller_no_show_answer_by: N }, N,
  (a) => a.r.seller_report_unanswered === 1 && a.calls.includes("strike:delivery_no_show") && a.calls.includes("reopen:helpr_no_show") && a.t.settled === "2026-07-15 20:00:00+00");
await edge("open, no Helpr took it", { status: "open", open_until: N }, N, (a) => a.calls[0] === "close:unfilled" && a.r.unfilled === 1);
await edge("Helpr no-show, 2 h after the pickup time", { status: "accepted", pickup_slot_start: N - 2 * H }, N,
  (a) => a.r.helpr_no_show === 1 && a.calls.includes("reopen:helpr_no_show") && a.calls.includes("strike:delivery_no_show"));
await edge("delivered 24 h ago, nobody said anything", { status: "delivered", delivered_at: N - 24 * H }, N, (a) => a.calls[0] === "event:confirmed" && a.r.auto_confirmed === 1);
await edge("picked up 24 h ago, never delivered", { status: "picked_up", picked_up_at: N - 24 * H }, N,
  (a) => a.r.still_in_hand_nudged === 1 && a.t.nudged === "2026-07-15 20:00:00+00");
await edge("still in hand, last nudged 7 days ago", { status: "picked_up", picked_up_at: N - 20 * D, in_hand_nudged_at: N - 7 * D }, N,
  (a) => a.r.still_in_hand_nudged === 1);
await edge("can't finish: the buyer's 24 h to fix ran out", { status: "picked_up", picked_up_at: N - 2 * D, in_hand_nudged_at: N, stuck_stage: "waiting_fix", stuck_fix_by: N }, N,
  (a) => a.t.stuck_stage === "returning" && a.t.rb === "2026-07-17 20:00:00+00" && a.r.stuck_steps === 1);

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
