/**
 * BUY-39 server half (buying audit 10-30 #39; lead verdict 10-31): the buyer's "I got it" on a Helpr delivery
 * finished the sale (Helpr and seller paid) while the item was still in the Helpr's car, because
 * helpr_task_customer_confirm took status 'picked_up' at any time. The app shows I got it only from the drop-off, or
 * once the Helpr has held it 24 hours (src/lib/declutter/stillInHand.ts, BUY-37); the server now refuses the same.
 *
 * Reads the NEWEST definition (effectiveDefs replays every migration, any dollar-quote tag) and pins the 24-hour rule,
 * that it matches the app's STILL_IN_HAND_MS, and that the refusal has words at the call site.
 * Backend proof: src/test/pglite/helprTaskConfirmNotOnTheRoad.pglite.mjs (3x replay; NEW_MIGRATION=skip RED).
 *
 * @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql | t.picked_up_at > now() - interval '24 hours' | t.picked_up_at > now() - interval '1 minute'
 * @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql |   IF t.status = 'picked_up' AND t.stuck_stage IS DISTINCT FROM 'collecting' |   IF t.status = 'no_such' AND t.stuck_stage IS DISTINCT FROM 'collecting'
 * @mutate src/lib/declutter/errors.ts |   delivery_on_the_way: "The Helpr is still bringing it. Tap I got it once it's dropped off.", |   delivery_on_the_way: "Something went wrong.",
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { HELPR_TASK_RPC_ERROR_COPY } from "@/lib/helprTasks/errorCopy";

const REPO = resolve(__dirname, "..", "..");
const DEFS = effectiveDefs(join(REPO, "supabase", "migrations"));
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");

describe("The buyer's I got it on a Helpr delivery is refused while it is on the road (BUY-39)", () => {
  it("the inventory read something: the function exists", () => {
    expect(body("helpr_task_customer_confirm").length).toBeGreaterThan(400);
  });

  it("picked_up is accepted only after 24 h in the Helpr's hands; delivered still finishes it", () => {
    const fn = body("helpr_task_customer_confirm");
    expect(fn).toMatch(/IF t\.status NOT IN \('picked_up', 'delivered'\) THEN/);
    expect(fn).toMatch(
      // BUY-36 (20261031231150): the one exception is a buyer collecting it from a Helpr at fault (stuck_stage 'collecting').
      /IF t\.status = 'picked_up' AND t\.stuck_stage IS DISTINCT FROM 'collecting' AND \(t\.picked_up_at IS NULL OR t\.picked_up_at > now\(\) - interval '24 hours'\) THEN RAISE EXCEPTION 'delivery_on_the_way'/,
    );
    const onRoad = fn.indexOf("'delivery_on_the_way'");
    const pays = fn.indexOf("helpr_task_source_event(t.id, 'confirmed', 'customer')");
    expect(onRoad).toBeGreaterThan(0);
    expect(pays).toBeGreaterThan(onRoad);
  });

  it("the server's 24 hours is the app's (stillInHand)", () => {
    const app = blankComments(readFileSync(join(REPO, "src/lib/declutter/stillInHand.ts"), "utf8"));
    expect(app).toMatch(/const STILL_IN_HAND_MS = 24 \* 3_600_000;/);
  });

  it("the refusal has words where the buyer taps I got it", () => {
    const copy = HELPR_TASK_RPC_ERROR_COPY.helpr_task_customer_confirm as Record<string, string>;
    expect(copy.delivery_on_the_way).toBe("The Helpr is still bringing it. Tap I got it once it's dropped off.");
  });
});
