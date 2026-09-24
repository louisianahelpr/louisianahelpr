/**
 * Stripe Checkout's Card fields are opened in ONE place: e2e/stripeCheckoutCard.ts.
 *
 * Three copies of a one-shot forced radio click lived in the fixtures; when
 * Stripe's page had not wired its handlers yet the click did nothing, the
 * fixture sat 30s on `#cardNumber`, and prod-audit's whole messy-input sweep
 * went down with it (runs 35983716673, 35999386803). The helper repeats the
 * click until the fields open. This check keeps the class closed: no e2e file
 * that drives `#cardNumber` clicks a radio itself, and the helper retries.
 */
// @mutate e2e/stripeCheckoutCard.ts |  for (let i = 0; i < attempts; i++) { | for (let i = 0; i < 1; i++) {
// @mutate e2e/prod-audit/fundedOpenJob.ts |     await openCardFields(page); |     if (!(await card.isVisible().catch(() => false))) await radio.click({ force: true });
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const HELPER = "e2e/stripeCheckoutCard.ts";

function e2eFiles(dir = join(ROOT, "e2e")): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : e2eFiles(p);
    return /\.(ts|mjs)$/.test(n) ? [p] : [];
  });
}

describe("Stripe Checkout card fields open through the shared helper", () => {
  const drivers = e2eFiles()
    .map((p) => ({ rel: p.slice(ROOT.length + 1), src: readFileSync(p, "utf8") }))
    .filter((f) => f.rel !== HELPER && f.src.includes('"#cardNumber"') && /4242|TEST_CARD/.test(f.src));

  it("finds the files that pay a Checkout Session (the inventory is not empty)", () => {
    expect(drivers.length).toBeGreaterThan(2);
    expect(drivers.map((d) => d.rel).sort()).toEqual(
      ["e2e/journeys/fixtures.ts", "e2e/prod-audit/fundedOpenJob.ts", "e2e/prod-lifecycle.spec.ts"],
    );
  });

  it("no driver clicks a payment-method radio itself; each calls openCardFields", () => {
    const offenders = drivers.filter((d) => /\.click\(\{\s*force:\s*true\s*\}\)/.test(d.src) && /getByRole\("radio"\)/.test(d.src) && !d.src.includes("openCardFields(page)"));
    const hand = drivers.filter((d) => /(radio|methodRadio)\.click\(/.test(d.src));
    expect(offenders.map((d) => d.rel)).toEqual([]);
    expect(hand.map((d) => d.rel)).toEqual([]);
    for (const d of drivers) expect(d.src, `${d.rel} must open the card fields via openCardFields`).toContain("openCardFields(page)");
  });

  it("the helper repeats the click more than once before giving up", () => {
    const src = readFileSync(join(ROOT, HELPER), "utf8");
    const m = /for \(let i = 0; i < (\w+); i\+\+\)/.exec(src);
    expect(m, "openCardFields has no retry loop").not.toBeNull();
    const bound = m![1] === "attempts" ? Number(/attempts = (\d+)/.exec(src)?.[1]) : Number(m![1]);
    expect(bound).toBeGreaterThan(1);
    expect(src).toMatch(/radio\.click\(\{ force: true \}\)/);
  });
});
