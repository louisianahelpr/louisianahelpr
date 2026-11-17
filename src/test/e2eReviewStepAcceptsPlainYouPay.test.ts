/**
 * F304 (owner 2026-11-11, b5e3efce3e): a plain job's Post a job review card is
 * "You pay $N" (CheckoutPlainYouPay, data-plain-you-pay) with no "Payment
 * breakdown" heading. Three e2e specs still waited for the heading alone, so
 * every plain-job post timed out on the review step: slow-network 44053689473
 * (post, pay-start), e2e-journeys 43430382667 (02-marketplace), and the
 * prod-audit interruptions spec. Each now accepts either shape.
 *
 * @mutate e2e/slow-network/slow-network.spec.ts | page.getByText(/Payment breakdown/i).or(page.locator("[data-plain-you-pay]")).first() | page.getByText(/Payment breakdown/i)
 * @mutate e2e/journeys/02-marketplace.spec.ts | page.getByText(/Payment breakdown/i).or(page.locator("[data-plain-you-pay]")).first() | page.getByText(/Payment breakdown/i)
 * @mutate src/components/postjob/CheckoutPlainYouPay.tsx |  data-plain-you-pay="" |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const SPECS = ["e2e/slow-network/slow-network.spec.ts", "e2e/journeys/02-marketplace.spec.ts", "e2e/prod-audit/interruptions.spec.ts"];
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

describe("e2e review-step waits accept the plain You pay card (F304)", () => {
  it("the plain card carries the marker the specs wait on", () => {
    expect(code("src/components/postjob/CheckoutPlainYouPay.tsx")).toContain('data-plain-you-pay=""');
  });

  it("no spec waits for the Payment breakdown heading alone", () => {
    let waits = 0;
    for (const p of SPECS) {
      const src = code(p);
      const hits = [...src.matchAll(/getByText\(\/Payment breakdown\/i\)(\.or\(page\.locator\("\[data-plain-you-pay\]"\)\))?/g)];
      waits += hits.length;
      for (const h of hits) expect(h[1], `${p} waits for "Payment breakdown" alone; a plain job has no such heading`).toBeTruthy();
    }
    expect(waits).toBeGreaterThanOrEqual(SPECS.length);
  });
});
