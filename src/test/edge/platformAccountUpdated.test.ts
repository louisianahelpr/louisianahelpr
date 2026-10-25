/**
 * Early warning on our own Stripe account (owner 2026-10-25, after Stripe closed
 * it on 2026-10-23 and restored it the same afternoon). Before, account.updated
 * for the platform was skipped with "no profile links this account".
 */
import { describe, expect, it } from "vitest";
import { platformAccountProblems } from "../../../supabase/functions/stripe-webhook/handlers/platformAccountUpdated";
import { readFileSync } from "node:fs";

const healthy = {
  id: "acct_platform", charges_enabled: true, payouts_enabled: true,
  requirements: { currently_due: [], past_due: [], disabled_reason: null, current_deadline: null },
  future_requirements: { currently_due: [] },
  capabilities: { card_payments: "active", transfers: "active" },
};

describe("platform account early warning", () => {
  it("a healthy account reports nothing", () => {
    expect(platformAccountProblems(healthy as never)).toEqual({ problems: [], healthy: true });
  });

  it("the 2026-10-23 shape (charges and payouts off, capabilities inactive) reports each problem", () => {
    const closed = { ...healthy, charges_enabled: false, payouts_enabled: false, capabilities: { card_payments: "inactive", transfers: "inactive" } };
    const r = platformAccountProblems(closed as never);
    expect(r.healthy).toBe(false);
    expect(r.problems.join(" | ")).toMatch(/charges are OFF/);
    expect(r.problems.join(" | ")).toMatch(/payouts to our bank are OFF/);
    expect(r.problems.join(" | ")).toMatch(/card_payments is inactive/);
    expect(r.problems.join(" | ")).toMatch(/transfers is inactive/);
  });

  it("a requirement Stripe asks for, with its deadline, is reported before anything is switched off", () => {
    const due = { ...healthy, requirements: { ...healthy.requirements, currently_due: ["company.tax_id"], current_deadline: 1793000000 } };
    expect(platformAccountProblems(due as never).problems[0]).toMatch(/Stripe needs: company\.tax_id by 2026-/);
  });

  it("the webhook routes our own account's events to the alert, before the Helpr lookup", () => {
    const src = readFileSync("supabase/functions/stripe-webhook/handlers/accountUpdated.ts", "utf8");
    // @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts |   if (!event.account) { |   if (false) {
    expect(src).toMatch(/if \(!event\.account\) \{\s+await handlePlatformAccountUpdated\(event, logStep\);\s+return;/);
    expect(src.indexOf("handlePlatformAccountUpdated(event")).toBeLessThan(src.indexOf('.from("profiles")'));
  });
});
