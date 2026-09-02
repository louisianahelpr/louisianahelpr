import { describe, it, expect } from "vitest";
import { TIER_PERKS } from "./subscriptionTiers";
import { posterFeePercentForTier } from "./posterFees";
import {
  URGENT_FEE_FLOOR_DOLLARS,
  URGENT_FEE_PRESETS,
  DEFAULT_URGENT_FEE_DOLLARS,
  FORM_1099K_GROSS_THRESHOLD_DOLLARS,
  FORM_1099K_TRANSACTION_THRESHOLD,
  form1099kGrossLabel,
} from "./moneyLimits";

// moneyFigures.parity — guards the user-facing money figures that are NOT yet
// consolidated into a single importable config: the poster "service fee" %, and
// the urgent-job bonus floor / presets. These currently live as duplicated
// literals (a DB-backed value with a hardcoded fallback, plus prose in Legal /
// Terms). This test asserts the CURRENT canonical values so an unintended edit
// to any one copy site is caught, and TODO-flags the literals that should be
// promoted to a shared const so a real import-based guard becomes possible.
//
// Companion guards:
//   - helperFees.parity.test.ts     — helper-side platform commission ladder
//   - posterFees.parity.test.ts     — poster tier service-fee ladder + Stripe floor (UI↔edge)
//   - escrowTiming.parity.test.ts   — escrow auto-release schedule (48h/24h/72h)
//   - productPrices.parity.test.ts  — fixed boost / background-check prices

describe("poster service fee (%) — tier-derived, not a flat rate", () => {
  // SOURCE OF TRUTH: the poster's OWN subscription tier, resolved by
  // posterFeePercentForTier (src/lib/posterFees.ts), mirroring the same 12/11/10/8
  // ladder as the helper commission. The edge authority is
  // supabase/functions/_shared/posterFees.ts and the two are guarded against
  // drift by posterFees.parity.test.ts.
  //
  // platform_settings.customer_fee_percent (DB, admin-editable via
  // AdminSettings.tsx) is now only a FALLBACK, used when a poster's profile /
  // tier can't be read:
  //   src/pages/postjob/useJobFormEffects.ts     → `row.customer_fee_percent ?? 10` (fallback)
  //   supabase/functions/create-payment/index.ts → global percent only when posterProfile is null
  //
  // User copy that previously restated a flat "10%" must now describe the tiered
  // model (fixed in #107):
  //   src/pages/legal/TermsSection.tsx
  //   src/components/profile/LegalTab.tsx
  //   src/pages/helpCenter/helpCenterContent.ts

  it("resolves the poster fee from their tier via the shared ladder", () => {
    expect(posterFeePercentForTier("free")).toBe(12);
    expect(posterFeePercentForTier("pro")).toBe(10);
    expect(posterFeePercentForTier("elite")).toBe(8);
  });

  it("defaults an unknown/missing tier to the free (never-undercharge) rate", () => {
    expect(posterFeePercentForTier(null)).toBe(12);
    expect(posterFeePercentForTier(undefined)).toBe(12);
    expect(posterFeePercentForTier("nonsense")).toBe(12);
  });

  it("uses the SAME ladder as the helper-side tier commission", () => {
    // Poster service fee and helper platform fee share one 12/11/10/8 ladder —
    // one user, one tier, one percent. Assert the source ladder so a future
    // change to one tier is caught here too.
    expect(TIER_PERKS.free.platformFeePercent).toBe(12);
    expect(TIER_PERKS.basic.platformFeePercent).toBe(11);
    expect(TIER_PERKS.pro.platformFeePercent).toBe(10);
    expect(TIER_PERKS.elite.platformFeePercent).toBe(8);
    for (const tier of ["free", "basic", "pro", "elite"] as const) {
      expect(posterFeePercentForTier(tier)).toBe(TIER_PERKS[tier].platformFeePercent);
    }
  });
});

describe("urgent-job bonus — floor & presets", () => {
  // SOURCE OF TRUTH: the urgent bonus is POSTER-SET (not a fixed platform fee),
  // with a hard $5 minimum and quick-tap presets. It is validated in two places
  // that must agree:
  //   src/components/postjob/BudgetSection.tsx:103  → warn when `urgentFeeNum < 5`
  //   src/components/postjob/BudgetSection.tsx:412  → presets ["5","10","15","20"]
  //   src/components/postjob/BudgetSection.tsx:447  → <input min="5">
  //   src/pages/postjob/usePostJobForm.ts:84        → default urgentFee "5"
  //
  // These now import from the single source `moneyLimits.ts` — a change to
  // the floor/presets there flows through every consumer (BudgetSection,
  // useJobSubmit, LegalTab) automatically. This test still asserts the
  // CURRENT values so a policy change is a deliberate two-place edit
  // (moneyLimits.ts + this test), not a silent drift.

  it("enforces a $5 urgent-bonus floor", () => {
    expect(URGENT_FEE_FLOOR_DOLLARS).toBe(5);
  });

  it("presets start at the floor and ascend", () => {
    expect(URGENT_FEE_PRESETS[0]).toBe(URGENT_FEE_FLOOR_DOLLARS);
    expect([...URGENT_FEE_PRESETS]).toEqual([5, 10, 15, 20]);
    // presets are strictly increasing so the quick-tap row reads sensibly
    for (let i = 1; i < URGENT_FEE_PRESETS.length; i++) {
      expect(URGENT_FEE_PRESETS[i]).toBeGreaterThan(URGENT_FEE_PRESETS[i - 1]);
    }
  });

  it("default urgent bonus is at (not below) the floor", () => {
    expect(DEFAULT_URGENT_FEE_DOLLARS).toBeGreaterThanOrEqual(URGENT_FEE_FLOOR_DOLLARS);
  });
});

describe("Form 1099-K threshold — one number for the whole product", () => {
  // The Earnings tab used to disagree with ITSELF: the banner fired at "$600"
  // (a step-down the One Big Beautiful Bill repealed before it took effect)
  // while the tax note at the bottom of the same tab, and both Legal pages,
  // said $20,000 / 200 transactions. All four now import from moneyLimits:
  //   src/components/profile/EarningsTab.tsx              (banner gate + tax note)
  //   src/components/profile/earningsTab/ThresholdBanner.tsx (headline + body)
  //   src/pages/legal/TermsSection.tsx
  //   src/pages/legal/CommunitySection.tsx

  it("is the restored federal $20,000 / 200-transaction pair", () => {
    expect(FORM_1099K_GROSS_THRESHOLD_DOLLARS).toBe(20000);
    expect(FORM_1099K_TRANSACTION_THRESHOLD).toBe(200);
  });

  it("renders the gross threshold with a thousands separator", () => {
    expect(form1099kGrossLabel()).toBe("$20,000");
  });

  it("is not the repealed $600 step-down", () => {
    expect(FORM_1099K_GROSS_THRESHOLD_DOLLARS).not.toBe(600);
  });
});
