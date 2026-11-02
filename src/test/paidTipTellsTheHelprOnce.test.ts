/**
 * Q2329: a paid tip tells the Helpr ONCE. trg_notify_helper_tip ("<Name> tipped you $X") is the one producer: the
 * tip Checkout webhook's flip to 'paid' fires it, and the webhook no longer writes a second "You received a tip!".
 * A Helpr on a payout hold is not told "All of it is yours" (the webhook pulls that tip back; heldTipRepay tells them
 * when it reaches them).
 * Behaviour (real Postgres + the handler source): src/test/pglite/paidTipTellsTheHelprOnce.pglite.mjs (8 PASS; 4 FAIL
 * on main's trigger and handler; 4 planted SQL defects and the put-back webhook notice each red).
 *
 * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |         logStep("Tip marked as paid", { jobId: tipJobId, tipper: tipperId }); |         logStep("Tip marked as paid", { jobId: tipJobId, tipper: tipperId }); await insertNotifications(supabase, { user_id: tipHelperId, title: "You received a tip!", message: "x", type: "financial_alerts" });
 * @mutate supabase/migrations/20261102045334_paid_tip_tells_the_helpr_once.sql | v_msg, 'financial_alerts', '/tips/' | v_msg, 'payment', '/tips/'
 * @mutate supabase/migrations/20261102045334_paid_tip_tells_the_helpr_once.sql | IF EXISTS (SELECT 1 FROM public.payout_holds h WHERE h.helper_id = NEW.helper_id) THEN | IF false THEN
 * @mutate supabase/migrations/20261102045334_paid_tip_tells_the_helpr_once.sql |       RETURN NEW;\n    END IF;\n\n    SELECT COALESCE |     END IF;\n\n    SELECT COALESCE
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments, blankComments } from "./helpers/blankNonCode";

const HANDLER = "supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts";

describe("Q2329: a paid tip tells the Helpr once", () => {
  it("the webhook's tip branch writes no notice of its own", () => {
    const src = blankComments(readFileSync(HANDLER, "utf8"));
    const a = src.indexOf('if (sessionType === "tip")');
    const b = src.indexOf("const kind = (session.metadata as any)?.kind;", a);
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    const branch = src.slice(a, b);
    // Inventory floor: the branch is the real one (it flips the row and holds a held Helpr's tip back).
    expect(branch).toContain('.update({ payment_status: "paid" })');
    expect(branch).toContain("holdBackPaidTip(");
    expect(branch).not.toMatch(/insertNotifications\(|from\("notifications"\)|You received a tip!/);
  });

  it("the trigger is the producer, and skips a Helpr on a payout hold before it writes", () => {
    const d = effectiveDefs("supabase/migrations").get("notify_helper_on_tip");
    expect(d, "no live notify_helper_on_tip").toBeTruthy();
    const body = blankSqlComments(d!.stmt).replace(/\s+/g, " ");
    const skip = body.indexOf("IF EXISTS (SELECT 1 FROM public.payout_holds h WHERE h.helper_id = NEW.helper_id) THEN");
    const write = body.indexOf("INSERT INTO public.notifications");
    expect(skip).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(skip);
    // NOID-15: tips are "Payments and tips" (financial_alerts), the switch payouts sit under.
    expect(body).toContain("VALUES (NEW.helper_id, v_title, v_msg, 'financial_alerts', '/tips/' || NEW.id, NEW.job_id);");
    expect(body.slice(skip, write)).toMatch(/'skipped', v_title, NEW\.job_id, 'payout_hold'\); RETURN NEW; END IF;/);
  });
});
