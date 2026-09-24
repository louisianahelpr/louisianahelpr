/**
 * CC-003: the Post Job urgent-bonus copy said the bonus "goes straight to the
 * Helpr ... no platform fee applied", reading as 100%. Payout nets the card
 * processing off it (netUrgentFeeDollars, _shared/stripeFees.ts). While payout
 * deducts, the copy must say so and must not promise "straight to".
 *
 * @mutate src/components/postjob/BudgetSection.tsx | no platform fee, only card processing. | no platform fee applied.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const fees = readFileSync(resolve(ROOT, "supabase/functions/_shared/stripeFees.ts"), "utf8");
const copy = readFileSync(resolve(ROOT, "src/components/postjob/BudgetSection.tsx"), "utf8");

describe("urgent bonus copy matches what the Helpr nets (CC-003)", () => {
  it("names card processing while netUrgentFeeDollars deducts it", () => {
    const deducts = /return \(cents - stripePercentCostCents\(cents\)\) \/ 100;/.test(fees);
    expect(deducts, "netUrgentFeeDollars shape changed; re-derive this check").toBe(true);
    const urgent = copy.match(/For jobs that need doing right away\.[^<]*/)?.[0] ?? "";
    expect(urgent.length).toBeGreaterThan(0);
    expect(urgent).toMatch(/card processing/);
    expect(urgent).not.toMatch(/straight to the Helpr/);
  });
});
