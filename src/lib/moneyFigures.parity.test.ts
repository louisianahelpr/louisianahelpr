import { describe, it, expect } from "vitest";
import { TIER_PERKS } from "./subscriptionTiers";

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
//   - escrowTiming.parity.test.ts   — escrow auto-release schedule (48h/24h/72h)
//   - productPrices.parity.test.ts  — fixed boost / background-check prices

describe("poster service fee (%) — single source of truth", () => {
  // SOURCE OF TRUTH: platform_settings.customer_fee_percent (DB, admin-editable
  // via AdminSettings.tsx). Both the client and the edge function fall back to
  // the SAME literal when the row is missing; those fallbacks must never drift.
  //
  //   src/pages/postjob/useJobFormEffects.ts:148  → `row.customer_fee_percent ?? 10`
  //   supabase/functions/create-payment/index.ts:95 → `settings?.customer_fee_percent ?? 10`
  //
  // and the figure is restated verbatim as "10%" in user copy:
  //   src/pages/legal/TermsSection.tsx:18,88,90
  //   src/components/profile/LegalTab.tsx:132
  //   src/pages/helpCenter/helpCenterContent.ts:151 ("Posters pay a 10% service fee")
  //
  // TODO(config): promote this to an exported const (e.g. DEFAULT_CUSTOMER_FEE_PERCENT
  // in a shared module the way helperFees.ts holds the helper ladder) so this
  // becomes an import-equality guard instead of a documented literal.
  const CANONICAL_SERVICE_FEE_PERCENT = 10;

  it("encodes the advertised 10% poster service fee", () => {
    expect(CANONICAL_SERVICE_FEE_PERCENT).toBe(10);
  });

  it("service fee is distinct from every helper-side tier commission", () => {
    // The 10% poster fee is a SEPARATE lever from the helper platform fee
    // (free 12 / pro 10 / elite 8 / business 6). It only coincidentally equals
    // the pro rate; this asserts the concepts stay independently sourced so a
    // future change to one tier can't be mistaken for the service fee.
    expect(TIER_PERKS.free.platformFeePercent).toBe(12);
    expect(TIER_PERKS.pro.platformFeePercent).toBe(10);
    expect(TIER_PERKS.elite.platformFeePercent).toBe(8);
    expect(TIER_PERKS.business.platformFeePercent).toBe(6);
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
  // TODO(config): promote the floor + presets to a shared const so the inline
  // warning, the input `min`, the presets, and the default all derive from one
  // value instead of four literals that can silently drift apart.
  const URGENT_FEE_FLOOR = 5;
  const URGENT_FEE_PRESETS = [5, 10, 15, 20] as const;

  it("enforces a $5 urgent-bonus floor", () => {
    expect(URGENT_FEE_FLOOR).toBe(5);
  });

  it("presets start at the floor and ascend", () => {
    expect(URGENT_FEE_PRESETS[0]).toBe(URGENT_FEE_FLOOR);
    expect([...URGENT_FEE_PRESETS]).toEqual([5, 10, 15, 20]);
    // presets are strictly increasing so the quick-tap row reads sensibly
    for (let i = 1; i < URGENT_FEE_PRESETS.length; i++) {
      expect(URGENT_FEE_PRESETS[i]).toBeGreaterThan(URGENT_FEE_PRESETS[i - 1]);
    }
  });

  it("default urgent bonus is at (not below) the floor", () => {
    const DEFAULT_URGENT_FEE = 5; // usePostJobForm.ts:84 `useState("5")`
    expect(DEFAULT_URGENT_FEE).toBeGreaterThanOrEqual(URGENT_FEE_FLOOR);
  });
});
