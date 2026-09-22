import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IAP_CADENCES } from "@/lib/iap";

/**
 * THE CLASS: a duplicate-purchase guard that is exempted for SOME cadences.
 *
 * The original defect (measured on prod 2026-09-22): `create-pro-checkout`
 * wrapped its active-subscription check in `if (billing_cycle !== "one_time")`,
 * so a member holding a live monthly subscription was correctly refused a second
 * recurring plan but was ALLOWED to buy a one-time pass — paying twice for
 * overlapping access that grants nothing extra and can overwrite the window they
 * just bought.
 *
 * The guard is built from the app's own cadence inventory (`IAP_CADENCES`), not
 * from a hand-written list, so adding a fourth cadence cannot quietly inherit a
 * new exemption: the assertion is structural — the active-subscription lookup
 * must not sit inside a branch that tests `billing_cycle` against ANY cadence
 * literal.
 */

const FN = "supabase/functions/create-pro-checkout/index.ts";
const source = readFileSync(FN, "utf8");

/** Source with `//` and block comments stripped, so prose cannot satisfy or trip a check. */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const code = stripComments(source);

/**
 * The guard region: from the moment customer records are in hand to the
 * `isOneTime` derivation that legitimately routes Stripe's `mode`. Scoping here
 * (rather than the whole file) is deliberate — `const isOneTime = billing_cycle
 * === "one_time"` BELOW the guard is correct and must stay legal; a cadence
 * comparison ABOVE it is the exemption this class forbids.
 */
const guardRegion = (() => {
  const start = code.indexOf("customerId = customers.data[0].id;");
  const end = code.indexOf("const isOneTime =");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return code.slice(start, end);
})();

describe("create-pro-checkout refuses a second purchase on EVERY cadence", () => {
  it("still performs the active-subscription lookup at all", () => {
    // If this fails, the guard was deleted rather than un-exempted — every
    // assertion below would vacuously pass without it.
    // @mutate supabase/functions/create-pro-checkout/index.ts | await stripe.subscriptions.list({ customer: customer.id, status: "active", limit: 10 }) | null
    expect(code).toMatch(/stripe\.subscriptions\.list\(\{[^}]*status:\s*"active"/);
  });

  it("knows the cadences it is guarding (inventory is non-trivial)", () => {
    expect(IAP_CADENCES.length).toBeGreaterThanOrEqual(3);
    expect(IAP_CADENCES).toContain("one_time");
  });

  it.each(IAP_CADENCES)(
    "does not exempt the %s cadence from the active-subscription guard",
    (cadence) => {
      // The failure shape: a conditional that compares billing_cycle to this
      // cadence literal anywhere in the function. The guard must be
      // cadence-blind — every cadence is a second purchase.
      // @mutate supabase/functions/create-pro-checkout/index.ts | for (const customer of customers.data) { | if (billing_cycle !== "one_time") for (const customer of customers.data) {
      const exemption = new RegExp(
        String.raw`billing_cycle\s*[!=]==?\s*["']${cadence}["']`,
      );
      expect(
        exemption.test(guardRegion),
        `${FN} branches on billing_cycle === "${cadence}". A cadence-specific ` +
          `branch around the duplicate-purchase guard is how one_time got ` +
          `exempted; derive behaviour from isOneTime AFTER the guard instead.`,
      ).toBe(false);
    },
  );

  it("runs the guard unconditionally inside the customer-found branch", () => {
    // Structural: between finding customer records and the isOneTime split,
    // the only control flow may be the guard loop itself.
    expect(guardRegion).toContain("for (const customer of customers.data)");
    expect(guardRegion).not.toMatch(/if\s*\([^)]*billing_cycle/);
  });
});
