/**
 * Owner, 2026-10-08: "Remove verified. There should only be the stripe id
 * verified one." The own-profile header drew the helper-tier badge at tier 1,
 * labelled "Verified", beside the "Stripe ID verified" pill.
 *
 * The class: the tier ladder never draws its "Verified" rung on any profile
 * surface; ID is said once, as "Stripe ID verified".
 *
 * @mutate src/components/profile/HelperTierBadge.tsx |   if (tier === 0 || tier === 1) return null; |   if (tier === 0) return null;
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import HelperTierBadge from "@/components/profile/HelperTierBadge";

describe("no plain 'Verified' badge beside 'Stripe ID verified'", () => {
  it("an ID-verified, payout-ready Helpr with no track record (tier 1) draws no tier badge", () => {
    const { container } = render(
      <HelperTierBadge profile={{ stripe_identity_verified: true, stripe_account_id: "acct_1" }} stats={{ completedJobs: 0, avgRating: null, reviewCount: 0 } as never} size="sm" />,
    );
    expect(container.textContent ?? "").not.toMatch(/^Verified$|\bVerified\b/);
  });
});
