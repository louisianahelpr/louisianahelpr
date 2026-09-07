// The perk matrix is the one place that answers "does this tier get X?", so
// the thing worth testing is not any individual answer — it is that the table
// is COMPLETE and MONOTONIC, and that every gate in the codebase reads it
// instead of restating it.
//
// The bug this exists to make impossible (CC-019, 2026-09-07): Plus was
// restored on 2026-09-05 and eleven separate `tier === "basic" || tier ===
// "pro" || tier === "elite"` lists did not learn about it. A paying member was
// 403'd from Instant Payouts, scored zero priority placement, charged full
// price for a discounted boost, denied the monthly free boost, shown no badge
// on four surfaces, sorted below Basic in the dispute queue, counted as $0 of
// MRR, and their referrer was not paid the upgrade bonus. None of it errored.
//
// The reason no existing test caught it is the pattern CLAUDE.md calls
// "registries checked against themselves": every one of those tests derived
// its tier list FROM the same literal it was grading, so it could not fail for
// a member the literal never had. The assertions below derive the tier set
// from the LADDER (TIER_ORDER) and then diff — which is the only shape that
// can fail for a missing member.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  TIER_ORDER,
  TIER_PERK_MATRIX,
  hasPerk,
  normalizeTier,
  profileHasPerk,
  tierRank,
  tiersGrantingPerk,
  tiersGrantingPerkSentence,
  type TierPerkKey,
} from "../../supabase/functions/_shared/tierPerks";
import { TIER_PERKS, tierDisplayName } from "./subscriptionTiers";
import { TIER_FEE_PERCENT } from "../../supabase/functions/_shared/helperFees";

const PERK_KEYS = Object.keys(TIER_PERK_MATRIX.free) as TierPerkKey[];

/**
 * Perks a higher tier is allowed NOT to have. Exactly one, and it is not an
 * oversight: Elite gets `freeBoosts` (unlimited, checked first) instead of
 * `boostDiscount`, which is strictly better. Any SECOND entry here is a
 * pricing decision that needs the owner, not a test edit.
 */
const LADDER_EXEMPT: TierPerkKey[] = ["boostDiscount"];

describe("tier perk matrix — completeness", () => {
  it("has a row for every tier on the ladder and no extras", () => {
    expect(Object.keys(TIER_PERK_MATRIX).sort()).toEqual([...TIER_ORDER].sort());
  });

  it("gives every tier an explicit boolean for every perk", () => {
    for (const tier of TIER_ORDER) {
      for (const perk of PERK_KEYS) {
        expect(
          typeof TIER_PERK_MATRIX[tier][perk],
          `TIER_PERK_MATRIX.${tier}.${perk} is not a boolean`,
        ).toBe("boolean");
      }
    }
  });

  it("grants the free tier nothing", () => {
    // If a perk is true on free it is not a perk, it is a feature — and the
    // storefront is selling something everyone already has.
    for (const perk of PERK_KEYS) {
      expect(TIER_PERK_MATRIX.free[perk], `free should not hold "${perk}"`).toBe(false);
    }
  });

  it("names every ladder rung the fee table names", () => {
    // The fee ladder and the perk ladder are the same ladder. A tier in one
    // and not the other is the shape the Plus restore left behind.
    expect([...TIER_ORDER].sort()).toEqual(Object.keys(TIER_FEE_PERCENT).sort());
  });
});

describe("tier perk matrix — the ladder rule", () => {
  it("never lets a higher tier hold fewer perks than a lower one", () => {
    for (let i = 1; i < TIER_ORDER.length; i++) {
      const lower = TIER_ORDER[i - 1];
      const higher = TIER_ORDER[i];
      for (const perk of PERK_KEYS) {
        if (LADDER_EXEMPT.includes(perk)) continue;
        if (!TIER_PERK_MATRIX[lower][perk]) continue;
        expect(
          TIER_PERK_MATRIX[higher][perk],
          `${higher} costs more than ${lower} but does not grant "${perk}". ` +
            `Either grant it, or add "${perk}" to LADDER_EXEMPT with the reason.`,
        ).toBe(true);
      }
    }
  });

  it("prices the ladder strictly upward", () => {
    // The ladder rule above only means something if the order really is
    // cheapest-to-dearest — a mis-ordered TIER_ORDER would make every
    // assertion in this file quietly test the wrong direction.
    const prices = TIER_ORDER.map((t) => TIER_PERKS[t].price ?? 0);
    for (let i = 1; i < prices.length; i++) {
      expect(prices[i], `${TIER_ORDER[i]} must cost more than ${TIER_ORDER[i - 1]}`)
        .toBeGreaterThan(prices[i - 1]);
    }
  });

  it("drops the commission at every rung", () => {
    const fees = TIER_ORDER.map((t) => TIER_PERKS[t].platformFeePercent);
    for (let i = 1; i < fees.length; i++) {
      expect(fees[i], `${TIER_ORDER[i]} must take a smaller cut than ${TIER_ORDER[i - 1]}`)
        .toBeLessThan(fees[i - 1]);
    }
  });

  it("only exempts boostDiscount, and only because Elite gets boosts free", () => {
    expect(LADDER_EXEMPT).toEqual(["boostDiscount"]);
    const top = TIER_ORDER[TIER_ORDER.length - 1];
    expect(TIER_PERK_MATRIX[top].freeBoosts).toBe(true);
  });
});

describe("TIER_PERKS is populated from the matrix, not a second copy of it", () => {
  it("agrees with the matrix on every perk of every tier", () => {
    for (const tier of TIER_ORDER) {
      for (const perk of PERK_KEYS) {
        expect(
          (TIER_PERKS[tier] as unknown as Record<string, boolean>)[perk],
          `TIER_PERKS.${tier}.${perk} disagrees with TIER_PERK_MATRIX`,
        ).toBe(TIER_PERK_MATRIX[tier][perk]);
      }
    }
  });
});

describe("resolvers", () => {
  it("resolves unknown, null, empty and legacy ids to free", () => {
    for (const raw of [null, undefined, "", "business", "enterprise", "constructor", "__proto__"]) {
      expect(normalizeTier(raw), `${String(raw)} should resolve to free`).toBe("free");
      expect(hasPerk(raw, "instantPayout")).toBe(false);
      expect(tierRank(raw)).toBe(0);
    }
  });

  it("normalizes case", () => {
    expect(normalizeTier("PRO")).toBe("pro");
    expect(hasPerk("Plus", "instantPayout")).toBe(true);
  });

  it("ranks the ladder in order", () => {
    const ranks = TIER_ORDER.map((t) => tierRank(t));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(TIER_ORDER.length);
  });

  it("denies every perk when the subscription is not active", () => {
    for (const tier of TIER_ORDER) {
      for (const perk of PERK_KEYS) {
        expect(hasPerk(tier, perk, false)).toBe(false);
      }
    }
  });

  it("treats a null expiry as active and a past expiry as lapsed", () => {
    // The house convention, and the ONE reason this helper exists: two edge
    // functions had `: false` here and two had `: true`, so a comped member's
    // perks depended on which endpoint they hit.
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(profileHasPerk("pro", null, "instantPayout")).toBe(true);
    expect(profileHasPerk("pro", undefined, "instantPayout")).toBe(true);
    expect(profileHasPerk("pro", future, "instantPayout")).toBe(true);
    expect(profileHasPerk("pro", past, "instantPayout")).toBe(false);
  });

  it("does not strip perks on an unparseable expiry", () => {
    expect(profileHasPerk("pro", "not-a-date", "instantPayout")).toBe(true);
  });
});

describe("upgrade copy is derived from the same gate it explains", () => {
  it("names exactly the tiers that grant the perk", () => {
    expect(tiersGrantingPerk("instantPayout")).toEqual(["basic", "pro", "plus", "elite"]);
    expect(tiersGrantingPerkSentence("instantPayout", tierDisplayName))
      .toBe("Basic, Pro, Plus or Elite");
  });

  it("never tells a member to upgrade to a tier they already exceed", () => {
    // The literal 403 copy this replaces read "Upgrade to Basic, Pro or
    // Elite" and was shown to a Plus member. Any tier the gate ADMITS must
    // appear in the sentence the gate's refusal prints.
    for (const perk of PERK_KEYS) {
      const granting = tiersGrantingPerk(perk);
      const sentence = tiersGrantingPerkSentence(perk, tierDisplayName);
      for (const tier of granting) {
        expect(sentence, `"${perk}" copy omits ${tier}`).toContain(tierDisplayName(tier));
      }
    }
  });
});

/**
 * The static half: no gate anywhere may re-list the tiers.
 *
 * This is the assertion that would have failed on 2026-09-05. It walks the
 * real files rather than a registry, so it cannot be blind to a member it
 * never had.
 */
const repoRoot = resolve(__dirname, "../..");
const SCAN_ROOTS = [resolve(repoRoot, "src"), resolve(repoRoot, "supabase/functions")];

/** Files that legitimately enumerate tiers: the tables themselves and their tests. */
const ALLOWED = [
  "supabase/functions/_shared/tierPerks.ts",
  "supabase/functions/_shared/tierNames.ts",
  "supabase/functions/_shared/helperFees.ts",
  "supabase/functions/_shared/proTiers.ts",
  "supabase/functions/_shared/productTiers.ts",
  "supabase/functions/_shared/appleAppStore.ts",
  "supabase/functions/create-pro-checkout/index.ts",
  "src/lib/subscriptionTiers.ts",
  "src/lib/proTiers.ts",
  "src/lib/earlyAccess.ts",
  "src/lib/iap.ts",
  "src/lib/tierBadgeStyle.ts",
  "src/components/ProUpgradeSheet.tsx",
  "src/components/profile/subscriptionTab/tierConfig.tsx",
  "src/components/admin/AdminSettings.tsx",
  "src/components/admin/AdminSubscriptions.tsx",
  "src/components/admin/adminAnalyticsConstants.ts",
  "src/components/admin/adminAnalytics/types.ts",
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "node_modules" ? [] : walk(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

// A tier list written as a chain of equality checks against two or more of the
// PAID tier ids on one line — the exact shape of every gate CC-019 broke.
const PAID_IDS = TIER_ORDER.filter((t) => t !== "free");
const CHAIN = new RegExp(
  `===\\s*["'](?:${PAID_IDS.join("|")})["'][\\s\\S]{0,80}?===\\s*["'](?:${PAID_IDS.join("|")})["']`,
);

describe("no gate re-lists the tiers", () => {
  it("finds no multi-tier equality chain outside the tier tables themselves", () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of walk(root)) {
        const rel = file.slice(repoRoot.length + 1);
        if (ALLOWED.includes(rel)) continue;
        if (/\.test\.tsx?$|\.gen\.ts$|\/test\//.test(rel)) continue;
        const src = readFileSync(file, "utf8");
        for (const line of src.split("\n")) {
          // Skip comments — several files DESCRIBE the removed pattern.
          const trimmed = line.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
          if (CHAIN.test(line)) offenders.push(`${rel}: ${trimmed.slice(0, 120)}`);
        }
      }
    }
    expect(
      offenders,
      "These lines enumerate subscription tiers by hand. Ask hasPerk(tier, perk) " +
        "instead — a literal list cannot fail a test for a tier it never had.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
