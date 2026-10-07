/**
 * Q236 (owner, 2026-09-27): every Helpr payout is a WHOLE dollar, rounded
 * DOWN, and the platform keeps the cents. $41.87 owed pays $41.
 *
 * One rule, one place: `roundPayoutDownCents` in
 * supabase/functions/_shared/money.ts. This guard holds the class:
 *
 *  1. Inventory from source: every `transfers.create(` in supabase/functions
 *     (comments blanked). The per-file count is EXACT in both directions, so a
 *     new transfer site fails here until it is classified below.
 *  2. Each Helpr-payout site sets its `amount` from `roundPayoutDownCents`,
 *     either inline or through a local whose EVERY assignment goes through it.
 *  3. Transfers that are not a Helpr's job payout are allowlisted with the
 *     reason.
 *  4. The rule is defined once, and every display of a Helpr payout (client
 *     take-home, edge copy) floors the same way; float noise never costs a
 *     dollar.
 *  5. The other half of the same owner decision: user payments other than job
 *     checkout (gift card, boost, background-check fee) show whole dollars.
 *     Job checkout's exact-cents pins live in displayedMoneyMatchesReality.
 *  6. The floor is for Helpr payouts ONLY: a poster refund, a restored gift or
 *     a referral cash-out shows exact cents (`formatExactDollars`). Every
 *     `formatPayoutDollars(`/`formatPayoutCents(` argument is inventoried.
 */
// @mutate supabase/functions/release-payout/index.ts | let payoutCents = roundPayoutDownCents(unroundedPayoutCents); | let payoutCents = unroundedPayoutCents;
// @mutate supabase/functions/release-payout/index.ts |       payoutCents = roundPayoutDownCents(unroundedPayoutCents - onboardingFeeCents); |       payoutCents = unroundedPayoutCents - onboardingFeeCents;
// @mutate supabase/functions/void-cancelled-payments/index.ts | amount: roundPayoutDownCents(Math.round(memberPayout * 100)), | amount: Math.round(memberPayout * 100),
// @mutate supabase/functions/create-payment/index.ts | const amountCents = roundPayoutDownCents(Math.round(amount * 100)); | const amountCents = Math.round(amount * 100);
// @mutate supabase/functions/_shared/crewBlockFees.ts | const payoutCents = roundPayoutDownCents(Math.round((feeDollars - platformCut) * 100)); | const payoutCents = Math.round((feeDollars - platformCut) * 100);
// @mutate supabase/functions/_shared/money.ts | return Math.floor(whole / 100) * 100; | return whole;
// @mutate supabase/functions/execute-dispute-split/index.ts | : `$${formatExactDollars(refundDollars)} has been refunded | : `$${formatPayoutDollars(refundDollars)} has been refunded
// @mutate src/lib/productPrices.ts | `$${formatPrice(cents / 100)}` | `$${(cents / 100).toFixed(2)}`
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { roundPayoutDownCents, formatPayoutDollars, formatExactDollars } from "../../supabase/functions/_shared/money";
import { formatPriceFloor } from "@/lib/format";
import { formatFeeUsd } from "@/lib/productPrices";
import {
  floorPayoutDollars as clientFloor,
  helperTakeHomeDollars as clientTakeHome,
} from "@/lib/helperEarnings";
import {
  floorPayoutDollars as edgeFloor,
  helperTakeHomeDollars as edgeTakeHome,
} from "../../supabase/functions/_shared/helperEarnings";

type PayoutSite =
  | { kind: "var"; name: string }
  | { kind: "inline"; count: number };

/** Transfers that pay a Helpr for a job. Amount must go through the rule. */
const HELPR_PAYOUT_SITES: Record<string, PayoutSite> = {
  "supabase/functions/release-payout/index.ts": { kind: "var", name: "payoutCents" },
  "supabase/functions/process-scheduled-payouts/index.ts": { kind: "var", name: "payoutCents" },
  "supabase/functions/execute-dispute-split/index.ts": { kind: "var", name: "helperCents" },
  "supabase/functions/create-payment/index.ts": { kind: "var", name: "amountCents" },
  "supabase/functions/void-cancelled-payments/index.ts": { kind: "inline", count: 2 },
  // Q1390: a crew member's cancellation fee for a block, paid from the job's escrow.
  "supabase/functions/_shared/crewBlockFees.ts": { kind: "var", name: "payoutCents" },
};

/** Transfers that are not a Helpr's job payout, with the reason. */
const NOT_A_JOB_PAYOUT: Record<string, string> = {
  "supabase/functions/instant-payout/index.ts":
    "moves the instant-payout fee from the Helpr's own connected balance to the platform",
  "supabase/functions/cash-out-credits/index.ts":
    "cashes out referral/credit balance the user already holds, at its exact value",
  "supabase/functions/_shared/chargebackClawback.ts":
    "re-pays exactly the cents a clawback reversed (row.reversed_cents); the original transfer was already rounded",
  "supabase/functions/_shared/heldTipRepay.ts":
    "re-pays exactly the tip cents a payout hold reversed (Q1222); a tip goes to the Helpr in full, never rounded",
};

/** EXACT per-file count of `transfers.create(` (comments blanked). */
const EXPECTED_TRANSFER_CALLS: Record<string, number> = {
  "supabase/functions/cash-out-credits/index.ts": 1,
  "supabase/functions/create-payment/index.ts": 1,
  "supabase/functions/execute-dispute-split/index.ts": 1,
  "supabase/functions/instant-payout/index.ts": 1,
  "supabase/functions/process-scheduled-payouts/index.ts": 1,
  "supabase/functions/release-payout/index.ts": 1,
  "supabase/functions/_shared/chargebackClawback.ts": 1,
  "supabase/functions/_shared/crewBlockFees.ts": 1,
  "supabase/functions/_shared/heldTipRepay.ts": 1,
  "supabase/functions/void-cancelled-payments/index.ts": 2,
};

/** Every argument handed to the payout floor, per file. Each one is a Helpr's
 *  own payout (instant-payout's `netCents` is the Helpr's cash-out net). A
 *  refund, gift or credit figure appearing here is the bug. */
const PAYOUT_FORMAT_ARGS: Record<string, string[]> = {
  "supabase/functions/auto-release-payment/index.ts": ["helperPayout", "helperPayout"],
  "supabase/functions/create-payment/index.ts": ["helperPayout", "helperPayout"],
  "supabase/functions/_shared/crewBlockFees.ts": ["payoutCents / 100"],
  "supabase/functions/execute-dispute-split/index.ts": ["helperDollars"],
  "supabase/functions/instant-payout/index.ts": ["netCents"],
  "supabase/functions/process-scheduled-payouts/index.ts": ["helperPayout", "helperPayout"],
  "supabase/functions/void-cancelled-payments/index.ts": ["helperPayout", "memberPayout"],
  "supabase/functions/weekly-helper-report/index.ts": ["weeklyEarnings"],
};

function edgeFiles(): string[] {
  return execFileSync("git", ["ls-files", "supabase/functions"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f));
}

const code = (f: string) => blankComments(readFileSync(f, "utf8"));
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("Helpr payouts are whole dollars, rounded down (Q236)", () => {
  it("inventory: every transfers.create in supabase/functions is known, exact count", () => {
    const found: Record<string, number> = {};
    for (const f of edgeFiles()) {
      const n = count(code(f), /\btransfers\.create\(/g);
      if (n > 0) found[f] = n;
    }
    expect(found).toEqual(EXPECTED_TRANSFER_CALLS);
    expect(Object.values(found).reduce((a, b) => a + b, 0)).toBe(11);
    // Every file is classified exactly once.
    for (const f of Object.keys(found)) {
      const classes = [f in HELPR_PAYOUT_SITES, f in NOT_A_JOB_PAYOUT].filter(Boolean).length;
      expect(classes, `${f} must be a Helpr payout site or allowlisted, not both/neither`).toBe(1);
    }
  });

  for (const [file, site] of Object.entries(HELPR_PAYOUT_SITES)) {
    it(`${file} sets the transfer amount through roundPayoutDownCents`, () => {
      const src = code(file);
      expect(src).toMatch(/import\s*\{[^}]*\broundPayoutDownCents\b[^}]*\}\s*from\s*"\.\.\/_shared\/money\.ts"/);
      if (site.kind === "inline") {
        const calls = count(src, /\btransfers\.create\(/g);
        expect(count(src, /\bamount:\s*roundPayoutDownCents\(/g)).toBe(site.count);
        expect(site.count).toBe(calls);
        return;
      }
      const v = site.name;
      expect(src, `transfer params must read amount: ${v}`).toMatch(new RegExp(`\\bamount:\\s*${v}\\b`));
      // Every assignment to the amount local (declaration or reassignment,
      // not ==/===) must be `roundPayoutDownCents(...)`.
      const assign = new RegExp(`\\b${v}\\s*=(?!=)\\s*([^;]*)`, "g");
      const rhs = [...src.matchAll(assign)].map((m) => m[1].trim());
      expect(rhs.length, `no assignment to ${v} found`).toBeGreaterThan(0);
      for (const r of rhs) {
        expect(r, `${file}: ${v} = ${r}`).toMatch(/^roundPayoutDownCents\(/);
      }
    });
  }

  it("the rule is defined once, in _shared/money.ts", () => {
    const defs = edgeFiles().filter((f) => /function\s+roundPayoutDownCents\b/.test(code(f)));
    expect(defs).toEqual(["supabase/functions/_shared/money.ts"]);
    const clientDefs = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => /function\s+roundPayoutDownCents\b/.test(code(f)));
    expect(clientDefs).toEqual([]);
  });

  it("roundPayoutDownCents: $41.87 → $41, float noise never costs a dollar", () => {
    expect(roundPayoutDownCents(4187)).toBe(4100);
    expect(roundPayoutDownCents(4186.9999999)).toBe(4100);
    expect(roundPayoutDownCents(4199.9999999)).toBe(4200);
    expect(roundPayoutDownCents(4099.9999999)).toBe(4100);
    expect(roundPayoutDownCents(4100)).toBe(4100);
    expect(roundPayoutDownCents(99)).toBe(0);
    expect(roundPayoutDownCents(0)).toBe(0);
    expect(roundPayoutDownCents(-150)).toBe(-150);
    expect(roundPayoutDownCents(Number.NaN)).toBe(0);
  });

  it("every payout display floors the same way, on both sides", () => {
    // 410 ÷ 3 at 10% = 122.99999999999999 in floats: that is $123, not $122.
    const noisy = 122.99999999999999;
    expect(formatPayoutDollars(noisy)).toBe("123");
    expect(formatPriceFloor(noisy)).toBe("123");
    expect(clientFloor(noisy)).toBe(123);
    expect(edgeFloor(noisy)).toBe(123);
    expect(formatPayoutDollars(41.87)).toBe("41");
    expect(formatPriceFloor(41.87)).toBe("41");
    expect(clientFloor(41.87)).toBe(41);
    expect(edgeFloor(41.87)).toBe(41);

    // Take-home: $46.52 at 10% = $41.868 owed → $41 paid, on both sides.
    const job = { budget: 46.52, helper_fee_percent: 10 };
    expect(clientTakeHome(job, 10)).toBe(41);
    expect(edgeTakeHome(job, 10)).toBe(41);
    expect(clientTakeHome(job, 10) * 100).toBe(roundPayoutDownCents(Math.round(41.868 * 100)));
  });

  it("the payout floor formats Helpr payouts only; refunds/gifts/credits are exact", () => {
    const found: Record<string, string[]> = {};
    for (const f of edgeFiles()) {
      if (f === "supabase/functions/_shared/money.ts") continue;
      const args = [...code(f).matchAll(/\bformatPayout(?:Dollars|Cents)\(([^)]*)\)/g)].map((m) => m[1].trim());
      if (args.length) found[f] = args.sort();
    }
    expect(found).toEqual(PAYOUT_FORMAT_ARGS);
    expect(formatExactDollars(41.87)).toBe("41.87");
    expect(formatExactDollars(41)).toBe("41");
    expect(formatExactDollars(1234.5)).toBe("1,234.50");
    expect(formatExactDollars(Number.NaN)).toBe("0");
  });

  it("other user payments show whole dollars; only job checkout shows cents", () => {
    expect(formatFeeUsd(3500)).toBe("$35");
    expect(formatFeeUsd(240)).toBe("$2");
    const gift = code("src/pages/profile/GiftCard.tsx");
    expect(gift).not.toMatch(/\bformatPriceExact\b/);
    const prices = code("src/lib/productPrices.ts");
    expect(prices).not.toMatch(/\bformatPriceExact\b|toFixed\(2\)/);
  });
});
