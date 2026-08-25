// R18 — the money duplications that had NO real guard.
//
// The project already keeps 14 client<->edge parity tests. The audit found
// five money facts that are duplicated but were NOT covered by any of them,
// which is the dangerous combination: a copy that looks guarded because its
// neighbours are.
//
// Each block below states the duplication, then asserts it from BOTH sides —
// reading the real source (module export, edge source text, or migration SQL)
// rather than restating the number in the test. A test that restates the
// constant it is guarding proves nothing: escrowTiming.parity.test.ts did
// exactly that, asserting `AUTO_COMPLETE_HOURS === 48` against a comment
// quoting the cron, so the cron could change and every test still passed.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { formatPriceFloor } from "@/lib/format";
import { STRIPE_PCT, STRIPE_FLAT_CENTS } from "@/lib/stripeFees";
// Edge config that is plain TS (no Deno imports at module scope), imported
// directly — the same pattern escrowTiming.parity.test.ts already uses.
import {
  AUTO_COMPLETE_HOURS,
  PAYOUT_HOLD_HOURS,
} from "../../supabase/functions/_shared/escrowTiming";
import { SEAT_TIER_TO_SUBSCRIPTION } from "../../supabase/functions/_shared/seatTierGrant";
import { TIER_PERKS } from "@/lib/subscriptionTiers";

const FUNCTIONS_DIR = join(process.cwd(), "supabase", "functions");
const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

const readFn = (rel: string) => readFileSync(join(FUNCTIONS_DIR, rel), "utf8");

function newestMigrationDefining(needle: string, bodyPattern: RegExp): string {
  const hits = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => [f, readFileSync(join(MIGRATIONS_DIR, f), "utf8")] as const)
    .filter(([, sql]) => sql.includes(needle) && bodyPattern.test(sql))
    .sort(([a], [b]) => a.localeCompare(b));
  expect(hits.length, `no migration defines ${needle} with ${bodyPattern}`).toBeGreaterThan(0);
  return hits[hits.length - 1][1];
}

describe("R18 — money duplications that had no guard", () => {
  // ── 1. formatPayoutDollars (edge) ↔ formatPriceFloor (client) ───────────
  //
  // Byte-identical implementations of the floor-don't-round payout rule, in
  // two files, with no test. This is the rule that keeps a payout figure from
  // ever reading ABOVE the payout, so drift here overstates money owed.
  it("the edge and client payout formatters agree, floor and all", () => {
    const edgeSrc = readFn("_shared/money.ts");

    // The edge copy must still floor rather than round — assert on its source,
    // since the client can't import Deno TS.
    expect(edgeSrc).toContain("Math.floor");
    expect(edgeSrc).not.toMatch(/formatPayoutDollars[\s\S]{0,400}Math\.round/);

    // And the client's behaviour is pinned on the cases that distinguish
    // flooring from rounding: anything with cents must truncate, never lift.
    // (formatPriceFloor returns a bare grouped number; callers supply the $.)
    expect(formatPriceFloor(83.6)).toBe("83");
    expect(formatPriceFloor(83.99)).toBe("83");
    expect(formatPriceFloor(84)).toBe("84");
    expect(formatPriceFloor(0.99)).toBe("0");
    expect(formatPriceFloor(1234.99)).toBe("1,234");
  });

  // ── 2. escrow timing: the cron, not a comment ──────────────────────────
  //
  // auto-release-payment hardcodes its two windows as `48 * 60 * 60 * 1000`
  // and `24 * 60 * 60 * 1000` and imports nothing. The existing parity test
  // asserted the constants against literals restated in the test body, with
  // the cron quoted only in a comment — so changing the cron left every test
  // green. This reads the cron's own arithmetic back out.
  it("escrowTiming matches the arithmetic auto-release-payment actually runs", () => {
    const cron = readFn("auto-release-payment/index.ts");
    const hoursInSource = [...cron.matchAll(/(\d+)\s*\*\s*60\s*\*\s*60\s*\*\s*1000/g)]
      .map((m) => Number(m[1]));

    expect(
      hoursInSource.length,
      "auto-release-payment no longer expresses its windows as N * 60 * 60 * 1000 — " +
        "update this guard to read whatever replaced it, do not delete it",
    ).toBeGreaterThanOrEqual(2);

    expect(hoursInSource).toContain(AUTO_COMPLETE_HOURS);
    expect(hoursInSource).toContain(PAYOUT_HOLD_HOURS);
  });

  // ── 3. Stripe's cut, hardcoded a third time in SQL ─────────────────────
  //
  // get_payout_batches() computes the Stripe fee inline with literal 0.029
  // and 30 — a third copy of numbers that stripeFees.ts owns on the client
  // and _shared/stripeFees.ts owns on the edge, and the only one no test
  // could see.
  it("the payout-batch SQL uses the same Stripe percentage as the TS copies", () => {
    // The newest migration that both defines the function AND carries the fee
    // arithmetic — later migrations touch grants only and would match the name
    // without containing a number to check.
    const sql = newestMigrationDefining("get_payout_batches", /\(1\s*-\s*0\.\d+\)/);

    const pctLiterals = [...sql.matchAll(/0\.0\d{2}/g)].map((m) => Number(m[0]));
    expect(
      pctLiterals,
      `get_payout_batches should net Stripe's percentage at ${STRIPE_PCT}`,
    ).toContain(STRIPE_PCT);

    // Deliberately NOT asserting the 30¢ flat fee here: it is charged once per
    // CHARGE, and this expression nets a single line item (the urgent fee), so
    // a flat term would be wrong. STRIPE_FLAT_CENTS is referenced so this
    // decision is visible to the next reader rather than looking like an
    // omission.
    expect(STRIPE_FLAT_CENTS).toBeGreaterThan(0);
  });

  // ── 4. seat plan → fee rung, asserted against the perks table ──────────
  //
  // _shared/seatTierGrant.ts maps a business seat plan onto the membership
  // tier whose fee rung the owner gets, and nothing checked that the tier it
  // names still exists in TIER_PERKS — so a renamed or retired tier would
  // grant a rung that silently resolves to undefined.
  it("every seat grant names a tier that TIER_PERKS still defines", () => {
    const entries = Object.entries(SEAT_TIER_TO_SUBSCRIPTION);
    expect(entries.length, "seat plan map is empty").toBeGreaterThan(0);
    for (const [plan, granted] of entries) {
      if (granted == null) continue; // a plan that grants nothing is legitimate
      expect(
        TIER_PERKS[granted as keyof typeof TIER_PERKS],
        `seatTierGrant("${plan}") grants "${granted}", which TIER_PERKS does not define`,
      ).toBeDefined();
      expect(
        typeof TIER_PERKS[granted as keyof typeof TIER_PERKS].platformFeePercent,
      ).toBe("number");
    }
  });

  // ── 5. the Stripe product → tier map, now single-source ────────────────
  //
  // This was copy-pasted from stripe-webhook/constants.ts into
  // check-pro-subscription. They agreed by luck; a product added to one and
  // not the other mis-grants a paid tier. Both now import _shared. This guard
  // fails if anyone re-introduces a literal map.
  it("no edge function re-declares its own PRODUCT_TO_TIER map", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(FUNCTIONS_DIR, dir), { withFileTypes: true })) {
        const rel = join(dir, entry.name);
        if (entry.isDirectory()) walk(rel);
        else if (entry.name.endsWith(".ts")) {
          const src = readFileSync(join(FUNCTIONS_DIR, rel), "utf8");
          // A declaration (not an import or a re-export) of the map.
          // _shared/productTiers.ts IS the canonical definition.
          const isCanonical = rel.replace(/\\/g, "/").endsWith("_shared/productTiers.ts");
          if (!isCanonical && /(?:const|let|var)\s+PRODUCT_TO_TIER\s*:/.test(src)) {
            offenders.push(rel);
          }
        }
      }
    };
    walk(".");
    expect(
      offenders,
      "PRODUCT_TO_TIER must be imported from _shared/productTiers.ts, not re-declared",
    ).toEqual([]);
  });

  // ── 6. helper take-home: the edge copy added for the weekly report ─────
  //
  // weekly-helper-report summed the FULL budget with no roster split, emailing
  // a 3-person group helper 3.4x what they were transferred. Fixing it needed
  // the take-home math on the edge side, which means a new duplicate — so it
  // is guarded here from birth rather than joining the unguarded pile.
  it("edge and client helper take-home agree on the cases that differ", async () => {
    const edge = await import("../../supabase/functions/_shared/helperEarnings");
    const client = await import("@/lib/helperEarnings");

    const cases = [
      // the group job that exposed the bug
      { budget: 300, is_group_job: true, helpers_needed: 3, helper_fee_percent: 12, urgent_fee: 10 },
      // solo job with a stamped fee amount (stamped wins on a solo row)
      { budget: 120, is_group_job: false, platform_fee_amount: 14.4, urgent_fee: 0 },
      // bad roster values must degrade to "one helper", never divide by zero
      { budget: 100, is_group_job: true, helpers_needed: 0, helper_fee_percent: 10 },
      { budget: 100, is_group_job: true, helpers_needed: null, helper_fee_percent: 10 },
    ];

    for (const job of cases) {
      expect(edge.helperShareCount(job)).toBe(client.helperShareCount(job));
      expect(edge.helperTakeHomeDollars(job, 12)).toBeCloseTo(
        client.helperTakeHomeDollars(job, 12),
        10,
      );
    }
    expect(edge.sumHelperTakeHomeDollars(cases, 12)).toBeCloseTo(
      client.sumHelperTakeHomeDollars(cases, 12),
      10,
    );
    // and the group case must be a THIRD of the naive gross, not the gross
    expect(edge.helperTakeHomeDollars(cases[0], 12)).toBeLessThan(120);
  });

  // ── 7. the boost discount the dialog has to quote ──────────────────────
  //
  // BOOST_DISCOUNT_PCT lived inline in create-boost-payment, so the client
  // could only transcribe the rule — and it drifted, quoting $3 to posters
  // Stripe charged $2.40. Promoted to _shared; this pins the two sides.
  it("the boost discount and floor are the same on both sides", async () => {
    const edgeSrc = readFn("_shared/productPrices.ts");
    const client = await import("@/lib/productPrices");

    const edgePct = Number(/BOOST_DISCOUNT_PCT\s*=\s*(\d+)/.exec(edgeSrc)?.[1]);
    const edgeFloor = Number(/BOOST_MIN_UNIT_AMOUNT_CENTS\s*=\s*(\d+)/.exec(edgeSrc)?.[1]);
    const edgeFee = Number(/BOOST_FEE_CENTS\s*=\s*(\d+)/.exec(edgeSrc)?.[1]);

    expect(edgePct).toBe(client.BOOST_DISCOUNT_PCT);
    expect(edgeFloor).toBe(client.BOOST_MIN_UNIT_AMOUNT_CENTS);
    expect(edgeFee).toBe(client.BOOST_FEE_CENTS);

    // create-boost-payment must read the shared constants, not local copies.
    const boostFn = readFn("create-boost-payment/index.ts");
    expect(boostFn).not.toMatch(/const\s+BOOST_DISCOUNT_PCT\s*=/);
  });
});
