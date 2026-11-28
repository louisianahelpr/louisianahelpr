/**
 * Polish audit 11-27 #147 (~/.lh-shots/polish-audit-1127/FINDINGS.md, guides/her--sec-out-375--07.png): the guides'
 * "Common questions" read machine-made, run-on lists of five full product names per answer, 6-9 lines each. An answer
 * now names at most 3 gifts (QA_NAMED), and the Louisiana answer says how many there are before "A few:". The crawler
 * copy (api/share.ts) reads the same functions. Inventory: every answer of Her, Him and Kids built from 12 picks per
 * price band, plus the 25 Days sponsors page.
 *
 * @mutate src/lib/guideQa.mjs | export const QA_NAMED = 3; | export const QA_NAMED = 5;
 * @mutate src/lib/guideQa.mjs | ${la.length > NAMED ? "A few: " : ""}${list(la.slice(0, NAMED) | ${list(la.slice(0, 5)
 */
import { describe, expect, it } from "vitest";
import { QA_NAMED, catalogGuideQa, type QaPick } from "@/lib/guideQa.mjs";

const TODAY = "2026-11-28";
const PRICES = [5, 15, 30, 60, 90, 150];
const picks: QaPick[] = PRICES.flatMap((price) =>
  Array.from({ length: 12 }, (_, i) => ({ name: `Gift${price}x${i}`, price, priceAt: "2026-11-27", la: i % 2 === 0, brand: `Brand${price}x${i}` })),
);
const namesIn = (a: string) => (a.match(/\b(?:Gift|Brand)\d+x\d+\b/g) ?? []).length;

const answers = (["her", "him", "kids", "25-days-sponsors"] as const).flatMap((slug) =>
  catalogGuideQa(slug, picks, TODAY).map((x) => [slug, x.q, x.a] as const),
);

describe("#147: guide Q&A answers name at most 3 gifts", () => {
  it("builds every answer (inventory floor)", () => {
    expect(answers.length).toBeGreaterThan(15);
    expect(QA_NAMED).toBe(3);
  });
  it.each(answers)("%s: %s", (_slug, _q, a) => {
    expect(namesIn(a)).toBeLessThanOrEqual(3);
  });
  it("a list that names only some of them says so", () => {
    const la = answers.find(([slug, q]) => slug === "her" && /Louisiana/.test(q));
    expect(la?.[2]).toMatch(/^Yes, 36 gifts from Louisiana makers or Louisiana shops\. A few: /);
  });
});
