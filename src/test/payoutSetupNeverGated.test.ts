/**
 * Owner 2026-10-20/21 (shell brief): payout setup stays available ANY time.
 * The Stripe Identity gate (first accept, posting, start) must never spread to
 * it: no ID check, no setup fee, no job is needed to connect a payout account.
 * Measured 2026-10-21: stripe-connect's onboard path reads none of them, and
 * Money shows the connect card to every member Stripe says is not connected.
 *
 * @mutate src/components/profile/EarningsTab.tsx | const showConnect = stripeAnswered && !stripeData?.connected; | const showConnect = stripeAnswered && !stripeData?.connected && !!profile?.idv_status;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const read = (f: string) => blankComments(readFileSync(join(ROOT, f), "utf8"));

describe("payout setup is never gated", () => {
  it("stripe-connect reads no ID check, setup fee or job state before onboarding", () => {
    const fn = read("supabase/functions/stripe-connect/index.ts");
    for (const gate of [/\bidv_status\b/, /identity_is_verified/, /onboarding_fee_paid/, /identity_check_exempt/, /from\("jobs"\)/]) {
      expect(fn).not.toMatch(gate);
    }
  });
  it("Money shows the connect card to everyone not yet connected", () => {
    expect(read("src/components/profile/EarningsTab.tsx")).toMatch(/const showConnect = stripeAnswered && !stripeData\?\.connected;/);
  });
});
