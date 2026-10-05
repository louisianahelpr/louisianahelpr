/**
 * Q362 / CC-003 (owner MQ11, 2026-09-24): "the poster pays the card fee ON TOP
 * so the Helpr gets 100%" — the tip rule (ME-006), applied to the urgent bonus.
 *
 * Before: netUrgentFeeDollars took 2.9% off the bonus in every payout path and
 * every earnings display, get_payout_batches repeated that in SQL as
 * `urgent_fee * (1 - 0.029)`, and the Post Job copy said "only card processing"
 * was taken. Now the Helpr receives the whole bonus and the poster is charged
 * `urgentBonusCardFeeCents` as its own checkout line (create-payment; the
 * Post-a-Task quote shows the same line, useJobDerived).
 *
 * The CLASS this guards: any place that nets the urgent bonus. Inventory:
 *   (1) the one definition, both runtimes (behaviour, not text);
 *   (2) every non-test source file under supabase/functions and src that
 *       mentions the urgent fee: no line pairs it with the card rate;
 *   (3) the NEWEST migration definition of every SQL function that reads
 *       urgent_fee: no 2.9% netting;
 *   (4) the poster's card fee is exactly the bundled fixed point.
 * The checkout half (the line item and customer_fee_amount) is pinned in
 * src/test/edge/create-payment.test.ts "Q362".
 *
 * @mutate supabase/functions/_shared/stripeFees.ts |   return cents / 100;\n} |   return (cents - stripePercentCostCents(cents)) / 100;\n}
 * @mutate src/lib/stripeFees.ts |   return cents / 100;\n} |   return (cents - stripePercentCostCents(cents)) / 100;\n}
 * @mutate supabase/migrations/20261005172816_urgent_bonus_full_to_helpr_payout_batches.sql |       + COALESCE(j.urgent_fee, 0)\n |       + (COALESCE(j.urgent_fee, 0) * (1 - 0.029))\n
 * @mutate supabase/functions/_shared/posterFees.ts |   const prepaid = Math.max(0, prepaidCostCents); |   const prepaid = 0;
 * @mutate src/components/postjob/BudgetSection.tsx | gets all of your bonus | gets your bonus less card processing
 * @mutate supabase/functions/_shared/stripeFees.ts |   let fee = Math.ceil((urgentCents * STRIPE_PCT) / (1 - STRIPE_PCT));\n  while (fee > 0 && fee - 1 >= stripePercentCostCents(urgentCents + fee - 1)) fee--;\n  while (fee < stripePercentCostCents(urgentCents + fee)) fee++; |   const fee = stripePercentCostCents(urgentCents);
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import {
  netUrgentFeeDollars as edgeNet,
  urgentBonusCardFeeCents as edgeCardFee,
  stripePercentCostCents,
} from "../../supabase/functions/_shared/stripeFees";
import { netUrgentFeeDollars as clientNet, urgentBonusCardFeeCents as clientCardFee, stripeProcessingCostCents } from "@/lib/stripeFees";
import { posterServiceFeeCents as edgePosterFee } from "../../supabase/functions/_shared/posterFees";
import { posterServiceFeeCents as clientPosterFee } from "@/lib/posterFees";
import { walkSource, readSource } from "./helpers/walkSource";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = resolve(__dirname, "../..");

describe("Q362: the urgent bonus goes wholly to the Helpr; the poster pays its card fee", () => {
  it("(1) the one definition pays the whole bonus, in both runtimes", () => {
    for (const d of [5, 7.5, 10, 15, 33.33, 100, 249.99, 250]) {
      expect(edgeNet(d)).toBe(d);
      expect(clientNet(d)).toBe(d);
    }
    for (const d of [0, null, undefined, -5]) {
      expect(edgeNet(d)).toBe(0);
      expect(clientNet(d)).toBe(0);
    }
  });

  it("(2) no source file nets the urgent fee by the card rate", () => {
    const files = walkSource([resolve(ROOT, "supabase/functions"), resolve(ROOT, "src")])
      .filter((f) => !/\.(test|spec)\.tsx?$/.test(f) && !f.includes("/src/test/"))
      // The definitions, checked by behaviour above and below.
      .filter((f) => !/(_shared|src\/lib)\/stripeFees\.ts$/.test(f));
    expect(files.length).toBeGreaterThan(300);
    let mentioning = 0;
    const offenders: string[] = [];
    for (const f of files) {
      const raw = readSource(f);
      if (raw === null) continue;
      const code = blankComments(raw);
      if (!/urgent_?fee/i.test(code)) continue;
      mentioning++;
      code.split("\n").forEach((line, i) => {
        if (/^\s*import\b/.test(line)) return;
        if (/urgent/i.test(line) && /0\.029|0\.971|STRIPE_PCT|stripePercentCostCents|stripeProcessingCostCents/.test(line)) {
          offenders.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    // Inventory floor: the payout paths, displays and the checkout all read it.
    expect(mentioning).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });

  it("(3) no SQL function's newest definition nets urgent_fee", () => {
    const defs = effectiveDefs(resolve(ROOT, "supabase/migrations"));
    const readers = [...defs.entries()].filter(([, d]) => /urgent_fee/i.test(blankSqlComments(d.stmt)));
    expect(readers.length).toBeGreaterThan(3);
    expect(readers.map(([n]) => n)).toEqual(expect.arrayContaining(["get_payout_batches"]));
    const netting = readers
      .filter(([, d]) => /0\.029|0\.971/.test(blankSqlComments(d.stmt)))
      .map(([n, d]) => `${n} (${d.file})`);
    expect(netting).toEqual([]);
  });

  it("(4) the poster's card fee is the smallest fee covering the bundled card cost of bonus + fee", () => {
    for (let u = 500; u <= 25_000; u += 37) {
      const fee = edgeCardFee(u);
      expect(clientCardFee(u)).toBe(fee);
      expect(fee).toBeGreaterThanOrEqual(stripePercentCostCents(u + fee));
      expect(fee - 1).toBeLessThan(stripePercentCostCents(u + fee - 1));
    }
    expect(edgeCardFee(0)).toBe(0);
    expect(edgeCardFee(-1)).toBe(0);
  });

  // lh-money-escrow review of 7b6911484, finding 2: the service fee's floor
  // already covered the bonus's card cost, so with the card-fee line the poster
  // paid it twice whenever the floor won. The floor is lowered by the fee the
  // card-fee line prepaid; both runtimes, and the platform stays covered.
  it("(6) the poster pays the bonus's card cost once, and fee + card fee still cover Stripe", () => {
    let floorCases = 0;
    for (const budget of [300, 500, 700, 1000, 2000, 2500, 5000, 10_000, 40_000]) {
      for (const urgent of [0, 500, 2500, 10_000, 25_000]) {
        for (const pct of [8, 10, 12]) {
          const card = edgeCardFee(urgent);
          const other = urgent + card;
          const fee = edgePosterFee(budget, pct, other, card);
          expect(clientPosterFee(budget, pct, other, card)).toBe(fee);
          const total = budget + fee + urgent + card;
          const cost = stripeProcessingCostCents(total);
          expect(fee + card, `${budget}/${urgent}/${pct}`).toBeGreaterThanOrEqual(cost);
          const tier = Math.round((budget * pct) / 100);
          if (fee > tier) {
            floorCases++;
            // Floor-set: no more than rounding slack above Stripe's real cost.
            expect(fee + card - cost, `${budget}/${urgent}/${pct}`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
    expect(floorCases).toBeGreaterThan(3);
  });

  it("(5) the Post Job copy promises the whole bonus and names the fee on top", () => {
    const copy = readFileSync(resolve(ROOT, "src/components/postjob/BudgetSection.tsx"), "utf8");
    const urgent = copy.match(/For jobs that need doing right away\.[^<]*/)?.[0] ?? "";
    expect(urgent.length).toBeGreaterThan(0);
    expect(urgent).toMatch(/gets all of your bonus/);
    expect(urgent).toMatch(/card fee is added on top/);
  });
});
