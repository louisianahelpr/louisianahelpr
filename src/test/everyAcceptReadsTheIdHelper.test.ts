/**
 * CLASS CHECK: every path that BOOKS a Helpr asks the one ID-once helper
 * (owner, 2026-10-20: a Helpr's ID is "required but only once they are offered
 * and accept a job"; checked once, by ONE helper, everywhere).
 *
 * THE HELPER. public.helper_accept_block_reason(uuid): payout setup and the one
 * identity rule (identity_is_verified, 20261019051407). The poster's OFFER
 * (accept_application, accept_group_application, book_accepted_quote) is not a
 * booking and stays ungated; the Helpr's accept that follows it is judged.
 *
 * THE BUG (measured live 2026-10-20, pg_get_functiondef): only the single-job
 * accept read the helper. rpc_group_member_confirm and
 * complete_pending_crew_confirms_on_setup read helper_award_block_reason
 * (payouts ONLY), so an unverified crew member's Accept my spot booked them;
 * claim_series_dates recorded holds with no readiness read, and
 * charge-recurring-visits books holds in server context, where jobs_award_gate
 * does not judge; complete_direct_offer_accept trusted its callers.
 *
 * INVENTORY (from source, comments blanked with the shared helpers):
 *   SQL  every function's EFFECTIVE (newest) definition in supabase/migrations
 *        that writes a booking: stamps jobs.helper_confirmed_at or
 *        group_job_helpers.helper_confirmed_at to a value, records a series
 *        hold (INSERT INTO series_visit_holds), takes a Declutter delivery
 *        (UPDATE helpr_tasks SET helpr_id), or calls one of the shared
 *        completions (complete_job_accept, complete_direct_offer_accept).
 *   TS   every non-test edge function file that writes helper_confirmed_at
 *        with a value (a server-context booking the trigger never sees).
 * Each must call helper_accept_block_reason itself, or sit in the EXACT
 * allowlist below saying which gated door it is behind (two-way: a stale entry
 * fails). The trigger the allowlist leans on is itself checked.
 *
 * Behaviour: src/test/pglite/idOnceEveryAccept.pglite.mjs (unverified refused
 * on every path, verified booked; red on prod's bodies with NEW_MIGRATION=skip).
 *
 * @mutate supabase/migrations/20261027185146_card_hold_at_post.sql |     v_reason := public.helper_accept_block_reason(v_uid);\n    IF v_reason = 'helper_unknown' THEN\n      RAISE EXCEPTION 'helper_unknown';\n    END IF;\n    IF v_reason IS NOT NULL THEN\n      INSERT INTO public.crew_confirm_pending |     v_reason := public.helper_award_block_reason(v_uid);\n    IF v_reason = 'helper_unknown' THEN\n      RAISE EXCEPTION 'helper_unknown';\n    END IF;\n    IF v_reason IS NOT NULL THEN\n      INSERT INTO public.crew_confirm_pending
 * @mutate supabase/migrations/20261027185146_card_hold_at_post.sql |   IF public.helper_accept_block_reason(NEW.user_id) IS NOT NULL THEN | IF public.helper_award_block_reason(NEW.user_id) IS NOT NULL THEN
 * @mutate supabase/migrations/20261021061341_member_display_name.sql |   v_block := public.helper_accept_block_reason(v_uid); |   v_block := NULL;
 * @mutate supabase/migrations/20261027185146_card_hold_at_post.sql |   IF public.helper_accept_block_reason(p_helper) IS NOT NULL THEN | IF false THEN
 * @mutate supabase/migrations/20261025162003_payout_after_hire.sql |                 AND EXISTS (SELECT 1 FROM public.test_accounts t WHERE t.user_id = p.user_id) THEN ARRAY[]::text[] |                 THEN ARRAY[]::text[]
 * @mutate supabase/migrations/20261031102758_helpr_backout_after_seller_move_is_free.sql |   v_reason := public.helper_accept_block_reason(v_uid);\n  IF v_reason = 'helper_identity_unverified' THEN |   v_reason := NULL;\n  IF v_reason = 'helper_identity_unverified' THEN
 * @mutate supabase/functions/charge-recurring-visits/index.ts | const { data: notReady, error: readyErr } = await supabase.rpc("helper_accept_block_reason", { p_user_id: helperId }); | const { data: notReady, error: readyErr } = { data: null, error: null };
 * @mutate supabase/functions/charge-recurring-visits/index.ts |           supabase.rpc("helper_accept_block_reason", { p_user_id: holderId }), |           Promise.resolve({ data: null, error: null }),
 * @mutate supabase/functions/card-hold-sweep/index.ts |     const { data: block, error: blockErr } = await db.rpc("helper_accept_block_reason", { p_user_id: r.helper_id }); |     const { data: block, error: blockErr } = { data: null, error: null };
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { readdirSync } from "./helpers/trackedFiles";

const REPO = resolve(__dirname, "..", "..");
const DEFS = effectiveDefs(join(REPO, "supabase", "migrations"));
const HELPER = /\bhelper_accept_block_reason\s*\(/i;

/** A booking write, in a function body with comments blanked. */
const BOOKING_WRITES: RegExp[] = [
  // jobs / group_job_helpers confirmation stamped to a value (clearing it to NULL is not a booking)
  /\bUPDATE\s+(?:public\.)?(?:jobs|group_job_helpers)\b[^;]*?\bSET\b[^;]*?\bhelper_confirmed_at\s*=(?!\s*NULL\b)/i,
  /\bINSERT\s+INTO\s+(?:public\.)?(?:jobs|group_job_helpers)\s*\([^)]*\bhelper_confirmed_at\b/i,
  // a recorded series hold, booked later by charge-recurring-visits
  /\bINSERT\s+INTO\s+(?:public\.)?series_visit_holds\b/i,
  // a Declutter delivery taken (20261020044552): the Helpr's accept of a delivery
  /\bUPDATE\s+(?:public\.)?helpr_tasks\b[^;]*?\bSET\b[^;]*?\bhelpr_id\s*=(?!\s*NULL\b)/i,
  // the shared completions
  /\bcomplete_job_accept\s*\(/i,
  /\bcomplete_direct_offer_accept\s*\(/i,
];

/** `fn name` -> which gated door it sits behind. EXACT. */
// @two-way src/test/everyAcceptReadsTheIdHelper.test.ts:const stale =
const ALLOWED: Record<string, string> = {
  complete_job_accept:
    "the one completion's UPDATE; jobs_award_gate (enforce_helper_award_gate, checked below) calls helper_accept_block_reason on it in every user session, and every server caller (complete_pending_accepts_on_setup, complete_direct_offer_accept) calls the helper first",
  // Lead-approved 10-31 (b4): an admin fault decision re-stamps the faulted Helpr on a failed delivery; no booking.
  declutter_admin_decide_problem:
    "not a booking: an admin deciding a problem as the Helpr's fault closes the delivery as 'failed' and stamps back the Helpr the fault falls on (the task's Helpr or the one released, 20261101020052), so the strike and refund find them; admin only, and no delivery is taken",
  series_holds_on_hire:
    "seeds a series' holds for the recurring_helper_id when the parent is hired; that hire is the parent's accept, which went through accept_job_offer / respond_to_direct_offer (both call the helper), and charge-recurring-visits judges every holder again at booking",
};

const flatBody = (stmt: string) => blankSqlComments(stmt);

function sqlInventory(): { name: string; callsHelper: boolean }[] {
  const out: { name: string; callsHelper: boolean }[] = [];
  for (const [name, d] of DEFS) {
    const body = flatBody(d.stmt);
    if (name === "helper_accept_block_reason") continue;
    if (!BOOKING_WRITES.some((re) => re.test(body))) continue;
    out.push({ name, callsHelper: HELPER.test(body) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const TS_WRITE = /\bhelper_confirmed_at\s*:\s*(?:new\s+Date\b|now\b|["'`])/;
function tsInventory(): { file: string; callsHelper: boolean; calls: number }[] {
  return walk(join(REPO, "supabase", "functions"))
    .map((p) => p.slice(REPO.length + 1))
    .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
    .map((f) => ({ file: f, code: blankComments(readFileSync(join(REPO, f), "utf8")) }))
    .filter(({ code }) => TS_WRITE.test(code))
    .map(({ file, code }) => {
      const calls = code.match(/\.rpc\(\s*["']helper_accept_block_reason["']/g)?.length ?? 0;
      return { file, callsHelper: calls > 0, calls };
    });
}

/**
 * How many times each server-side booking file asks the helper. EXACT both ways
 * (LEAD-VACUOUS 10-31: charge-recurring-visits asks it twice, so "calls it at
 * least once" stayed green with either call removed).
 */
const TS_HELPER_CALLS: Record<string, number> = {
  // 1: completePendingAccept (a single job's accept that waited on the card hold);
  // 2: completePendingCrewConfirms (each crew seat's Accept my spot that waited).
  "supabase/functions/card-hold-sweep/index.ts": 2,
  // 1: the per-holder readiness check that releases an unready holder's due dates;
  // 2: the re-read right before the charge (a holder who turned unready since is skipped).
  "supabase/functions/charge-recurring-visits/index.ts": 2,
};

describe("every booking path asks the one ID-once helper (owner 2026-10-20)", () => {
  const sql = sqlInventory();

  it("finds exactly the booking writers (exact inventory, two-way: a new writer or a vanished one fails)", () => {
    // EXACT, measured 2026-10-20 from the migrations and diffed against live
    // pg_proc (lh-authz-rls review: the live writers of helper_confirmed_at and
    // helpr_tasks.helpr_id are all here). A new booking path must be added here
    // AND call the helper. declutter_admin_decide_problem since 20261101020052: it writes helpr_tasks.helpr_id
    // on a 'failed' close (the faulted Helpr stamped back), not a booking; allowlisted below.
    expect(sql.map((s) => s.name)).toEqual([
      "accept_job_offer", "claim_series_dates", "complete_direct_offer_accept", "complete_job_accept",
      "complete_pending_accepts_on_setup", "complete_pending_crew_confirms_on_setup", "declutter_admin_decide_problem", "helpr_task_accept",
      "quote_job_funded_hires_quoter", "respond_to_direct_offer", "rpc_group_member_confirm", "series_holds_on_hire",
    ]);
    expect(sql.length).toBeGreaterThan(8);
  });

  it("the helper's test-account carve-out needs test_accounts membership, never is_seed alone", () => {
    // lh-authz-rls review 2026-10-20 #1: is_seed is set at signup for any
    // fixture-shaped email, so is_seed alone let a stranger skip the ID.
    const missing = flatBody(DEFS.get("helper_accept_missing")?.stmt ?? "");
    expect(missing).toMatch(/WHEN p\.is_seed IS TRUE AND p\.stripe_account_id IS NULL\s+AND EXISTS \(SELECT 1 FROM public\.test_accounts t WHERE t\.user_id = p\.user_id\) THEN ARRAY\[\]::text\[\]/);
    expect(flatBody(DEFS.get("helper_accept_block_reason")?.stmt ?? "")).toMatch(/public\.helper_accept_missing\(p_user_id\)/);
  });

  it("each one calls helper_accept_block_reason, or is allowlisted behind a door that does", () => {
    const bad = sql.filter((s) => !s.callsHelper && !(s.name in ALLOWED)).map((s) => s.name);
    expect(bad).toEqual([]);
  });

  it("the allowlist is exact (no entry for a function that is not a writer, or that already calls the helper)", () => {
    const writers = new Map(sql.map((s) => [s.name, s.callsHelper]));
    const stale = Object.keys(ALLOWED).filter((n) => !writers.has(n) || writers.get(n) === true);
    expect(stale).toEqual([]);
  });

  it("the trigger the allowlist leans on judges every confirming write with the helper", () => {
    const gate = flatBody(DEFS.get("enforce_helper_award_gate")?.stmt ?? "");
    expect(gate).toMatch(/v_reason\s*:=\s*public\.helper_accept_block_reason\(NEW\.helper_id\)/);
    expect(gate).toMatch(/IF v_reason IS NOT NULL THEN\s+RAISE EXCEPTION '%', v_reason;/);
  });

  it("no booking path reads the payout-only helper as its accept gate", () => {
    // helper_award_block_reason checks payout setup ONLY; an accept gated on it
    // books an unverified Helpr (the crew bug).
    const payoutOnly = sql
      .filter((s) => /\bhelper_award_block_reason\s*\(/i.test(flatBody(DEFS.get(s.name)?.stmt ?? "")))
      .map((s) => s.name);
    expect(payoutOnly).toEqual([]);
  });

  it("every server-side booking in an edge function asks the helper too", () => {
    const ts = tsInventory();
    expect(ts.map((t) => t.file)).toEqual(expect.arrayContaining(["supabase/functions/charge-recurring-visits/index.ts"]));
    expect(ts.length).toBeGreaterThan(0);
    expect(ts.filter((t) => !t.callsHelper).map((t) => t.file)).toEqual([]);
  });

  it("each server-side booking asks the helper at every step that books (exact count per file)", () => {
    const ts = tsInventory();
    expect(Object.fromEntries(ts.map((t) => [t.file, t.calls]))).toEqual(TS_HELPER_CALLS);
  });
});
