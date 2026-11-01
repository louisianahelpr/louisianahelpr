/**
 * A payout put back in the queue starts a fresh run of tries (B21/B24 10-31; lead + reviewer: declutter_rebook_payout
 * and admin_payout_release set a Declutter payout back to 'pending' with attempts still at 12, and the payout run only
 * offers rows with attempts < 12, so it sat 'pending' forever while the seller's card said we "stopped trying").
 *
 * CLASS: every UPDATE of a payout table (declutter_payouts, helpr_task_payouts, shop_payouts), in the NEWEST definition
 * of every function (effectiveDefs replays every migration, any dollar-quote tag), whose SET can make the row 'pending'
 * also sets attempts = 0. The run's own failure path (status 'failed', attempts + 1) never sets 'pending', so it is
 * outside the class by construction.
 * Backend proof: src/test/pglite/declutterPayoutTriesRestart.pglite.mjs (3x replay; NEW_MIGRATION=skip RED).
 *
 * @mutate supabase/migrations/20261101233256_declutter_manager_payout_kind.sql | ELSE 'pending' END,\n         -- A rebooked payout starts a fresh run of tries (B24, 10-31): one rebooked after its last try would\n         -- otherwise sit 'pending' forever (declutter_payouts_due takes attempts < 12).\n         attempts = 0, next_attempt_at = now() | ELSE 'pending' END
 * @mutate supabase/migrations/20261101234732_declutter_manager_payout_admin_held.sql | UPDATE public.declutter_payouts SET status = 'pending', next_attempt_at = now(), attempts = 0, | UPDATE public.declutter_payouts SET status = 'pending', next_attempt_at = now(),
 * @mutate supabase/migrations/20261101234732_declutter_manager_payout_admin_held.sql | UPDATE public.helpr_task_payouts SET status = 'pending', next_attempt_at = now(), attempts = 0, | UPDATE public.helpr_task_payouts SET status = 'pending', next_attempt_at = now(),
 */
import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const REPO = resolve(__dirname, "..", "..");
const DEFS = effectiveDefs(join(REPO, "supabase", "migrations"));

interface Hit { fn: string; table: string; set: string }
const updates: Hit[] = [];
for (const [fn, d] of DEFS) {
  const code = blankSqlComments(d.stmt ?? "");
  for (const m of code.matchAll(/UPDATE\s+public\.(declutter_payouts|helpr_task_payouts|shop_payouts)\b\s+(?:\w+\s+)?SET\b([\s\S]*?)(?:\bWHERE\b|;)/gi)) {
    updates.push({ fn, table: m[1].toLowerCase(), set: m[2].replace(/\s+/g, " ") });
  }
}
const backToPending = updates.filter((u) => /\bstatus\s*=[^;]*'pending'/i.test(u.set));

describe("a payout put back to pending starts a fresh run of tries", () => {
  it("the inventory read something: payout UPDATEs and the ones that make a row pending", () => {
    expect(updates.length).toBeGreaterThan(10);
    expect(backToPending.length).toBeGreaterThan(3);
    const names = new Set(backToPending.map((u) => `${u.fn}:${u.table}`));
    for (const k of ["declutter_rebook_payout:declutter_payouts", "admin_payout_release:declutter_payouts",
      "admin_payout_release:helpr_task_payouts", "admin_payout_release:shop_payouts"]) expect(names).toContain(k);
  });

  it("each one sets attempts = 0 (the payout run only offers attempts < 12)", () => {
    const missing = backToPending.filter((u) => !/\battempts\s*=\s*0\b/i.test(u.set)).map((u) => `${u.fn} -> ${u.table}`);
    expect(missing).toEqual([]);
  });
});
