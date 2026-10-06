/**
 * Q1221 CLASS GUARD (owner decision 2026-10-05): a payout hold freezes the held
 * Helpr's Stripe AUTOMATIC payouts and the release puts them back, and nothing
 * else changes a Connect payout schedule behind that machinery's back.
 *
 *   1. INVENTORY, from source: every supabase/functions file (comments blanked)
 *      that writes a Connect payout schedule (`payouts: { schedule`). EXACT and
 *      two-way: stripe-connect creates accounts on `daily`, and
 *      payout-hold-stripe-sync is the only other writer, through
 *      _shared/payoutFreeze.ts. A third writer could unfreeze a held Helpr.
 *   2. Every way a hold changes (insert, re-place / deny, release) reaches the
 *      freeze ledger: one AFTER INSERT OR UPDATE OR DELETE row trigger on
 *      payout_holds runs queue_payout_schedule_freeze().
 *   3. The safety net is scheduled: 'payout-freeze-sync' runs the sweep through
 *      cron_record_work, and the edge function it calls is reachable with the
 *      service key (verify_jwt = false; the handler checks the key or an admin).
 *
 * Behaviour: src/test/payoutFreeze.test.ts (state machine, fake Stripe),
 * src/test/edge/payoutHoldStripeSync.test.ts (the edge function),
 * src/test/pglite/payoutHoldFreezesStripePayouts.pglite.mjs (SQL; 26 FAIL on the
 * live state, all PASS after), src/components/admin/AdminPayoutBatches.test.tsx
 * (the admin screen asks for the sync and says when Stripe did not take it).
 *
 * @mutate supabase/migrations/20261006020751_payout_hold_freezes_stripe_auto_payouts.sql |   AFTER INSERT OR UPDATE OR DELETE ON public.payout_holds |   AFTER INSERT OR UPDATE ON public.payout_holds
 * @mutate supabase/migrations/20261006020751_payout_hold_freezes_stripe_auto_payouts.sql | $c$SELECT public.cron_record_work('payout-freeze-sync', to_jsonb(public.sweep_payout_schedule_freezes()));$c$ | $c$SELECT 1;$c$
 * @mutate supabase/functions/instant-payout/index.ts | const hold = await checkPayoutHold(supabaseAdmin, user.id); | await stripe.accounts.update("acct_x", { settings: { payouts: { schedule: { interval: "daily" } } } });\n  const hold = await checkPayoutHold(supabaseAdmin, user.id);
 * @mutate supabase/migrations/20261006020751_payout_hold_freezes_stripe_auto_payouts.sql |     PERFORM public.cron_http_tag(v_req, 'payout-freeze-sync'); |     PERFORM 1;
 * @mutate supabase/config.toml | [functions.payout-hold-stripe-sync]\n    verify_jwt = false | [functions.payout-hold-stripe-sync]\n    verify_jwt = true
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { bodyOf, triggerInventory } from "./helpers/migrationTriggers";
import { jobCommands } from "./helpers/cronWorkRegister";

const ROOT = process.cwd();
const MIG = join(ROOT, "supabase", "migrations");
const FNS = join(ROOT, "supabase", "functions");

/** Files that write a Connect payout schedule, with how many writes. EXACT. */
const SCHEDULE_WRITERS: Record<string, number> = {
  // getOrCreateAccount: every new Connect account starts on `daily`.
  "supabase/functions/stripe-connect/index.ts": 1,
  // Q1221: pause (manual) and restore (the saved schedule), via payoutFreeze.ts.
  "supabase/functions/payout-hold-stripe-sync/index.ts": 1,
};

describe("Q1221: a payout hold freezes Stripe automatic payouts", () => {
  it("only the known files write a Connect payout schedule (exact, two-way)", () => {
    const found: Record<string, number> = {};
    for (const f of walkSource([FNS])) {
      if (!f.endsWith(".ts") || /\.test\.ts$/.test(f)) continue;
      const code = blankComments(readFileSync(f, "utf8"));
      const n = [...code.matchAll(/payouts\s*:\s*\{\s*schedule\b/g)].length;
      if (n > 0) found[relative(ROOT, f)] = n;
    }
    expect(Object.keys(found).length, "inventory floor: the scan found the writers").toBeGreaterThanOrEqual(2);
    expect(found).toEqual(SCHEDULE_WRITERS);
  });

  it("every hold change reaches the freeze ledger through one row trigger", () => {
    const files = migrationFiles(MIG).map((name) => ({ name, sql: readFileSync(join(MIG, name), "utf8") }));
    const trg = triggerInventory(files).get("payout_holds.trg_queue_payout_schedule_freeze");
    expect(trg?.fn).toBe("queue_payout_schedule_freeze");
    expect(trg?.timing.toLowerCase()).toBe("after");
    for (const op of ["insert", "update", "delete"]) expect(trg?.events.toLowerCase()).toContain(op);
  });

  it("the safety net is scheduled and can reach the edge function", () => {
    const cmds = jobCommands(migrationFiles(MIG).map((file) => ({ file, sql: readFileSync(join(MIG, file), "utf8") })));
    const cmd = cmds.get("payout-freeze-sync");
    expect(cmd, "payout-freeze-sync is not scheduled").toBeTruthy();
    expect(cmd?.command ?? "").toMatch(/cron_record_work\('payout-freeze-sync',\s*to_jsonb\(public\.sweep_payout_schedule_freezes\(\)\)\)/);

    // Its pg_net request is tagged under the job (Q174), so a failed or timed
    // out answer is filed by sweep_cron_http_failures instead of dropped
    // (lh-money-escrow review, 2026-10-05).
    const kick = effectiveDefs(MIG).get("kick_payout_schedule_sync");
    expect(kick, "kick_payout_schedule_sync is gone").toBeTruthy();
    const body = bodyOf(kick!.stmt);
    expect(body).toMatch(/net\.http_post/);
    expect(body).toMatch(/public\.cron_http_tag\(\s*v_req\s*,\s*'payout-freeze-sync'\s*\)/);

    const config = readFileSync(join(ROOT, "supabase", "config.toml"), "utf8");
    expect(config).toMatch(/\[functions\.payout-hold-stripe-sync\]\s*\n\s*verify_jwt = false/);
  });
});
