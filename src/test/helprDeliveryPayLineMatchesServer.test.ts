/**
 * LEAD-HELPR-PAYLINE (10-31): the Helpr's "Left at the door" toast (useTaskSteps.ts) promises "You're paid when the
 * buyer confirms, or after 24 hours." This holds that promise to the server, read from the NEWEST definitions:
 *   - helpr_task_sweep auto-confirms a delivered task 24 hours after delivered_at (unless a problem holds it);
 *   - helpr_task_confirm (buyer, auto or admin) creates the Helpr's payout row at once, 'pending';
 *   - helpr_task_payouts_due sends any pending row with no wait of its own (no sale_final, no extra hours): only an
 *     open problem holds it, and the toast's held branch says so.
 * If the server's timing changes, this fails and the toast must change with it.
 *
 * @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql | WHERE x.status = 'delivered' AND x.delivered_at + interval '24 hours' <= now() | WHERE x.status = 'delivered' AND x.delivered_at + interval '48 hours' <= now()
 * @mutate src/components/declutter/useTaskSteps.ts | You're paid when the buyer confirms, or after 24 hours. | You're paid when the buyer confirms, or after 48 hours.
 * @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql |           CASE WHEN v_amount = 0 THEN 'nothing_due' ELSE 'pending' END) | CASE WHEN v_amount = 0 THEN 'nothing_due' ELSE 'scheduled' END)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { newestFunction } from "./helpers/parityReaders";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const flat = (s: string) => s.replace(/\s+/g, " ");

describe("the Helpr's drop-off pay line matches the server (LEAD-HELPR-PAYLINE)", () => {
  const toastSrc = blankComments(readFileSync("src/components/declutter/useTaskSteps.ts", "utf8"));
  const hours = Number(/You're paid when the buyer confirms, or after (\d+) hours\./.exec(toastSrc)?.[1]);

  it("the sweep auto-confirms a delivered task after the same hours the toast says", () => {
    expect(hours).toBeGreaterThan(0);
    const sweep = flat(blankSqlComments(newestFunction("helpr_task_sweep").body));
    const m = [...sweep.matchAll(/x\.status = 'delivered' AND x\.delivered_at \+ interval '(\d+) hours' <= now\(\)/g)];
    expect(m.length).toBe(1);
    expect(Number(m[0][1])).toBe(hours);
    expect(sweep).toContain("PERFORM public.helpr_task_source_event(t.id, 'confirmed', 'auto')");
  });

  it("confirming creates the Helpr's payout at once, and the payout run adds no wait of its own", () => {
    const confirm = flat(blankSqlComments(newestFunction("helpr_task_confirm").body));
    expect(confirm).toContain("INSERT INTO public.helpr_task_payouts");
    expect(confirm).toContain("CASE WHEN v_amount = 0 THEN 'nothing_due' ELSE 'pending' END");
    const due = flat(blankSqlComments(newestFunction("helpr_task_payouts_due").body));
    expect(due).toContain("WHERE p.status IN ('pending', 'failed') AND p.next_attempt_at <= now()");
    expect(due).not.toMatch(/sale_final|interval/);
    // The one hold is an open problem, which the toast's held branch names.
    expect(due).toContain("AND NOT public.helpr_task_source_held(t.source_kind, t.source_id)");
    expect(toastSrc).toContain("A problem was reported on this sale, so your pay waits until Louisiana Helpr decides.");
  });
});
