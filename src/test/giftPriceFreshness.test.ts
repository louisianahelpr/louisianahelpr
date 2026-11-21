/**
 * Holiday audit D M4 (11-20): gift guide prices hide 3 days after their check (PickPrice.showsPrice), and only a local
 * price pass plus a train refreshes them. scripts/check-gift-price-freshness.mjs goes red two days in, from
 * staleness-watch.yml's morning run (a nightly-red issue), so the prices never silently all disappear.
 *
 * @mutate scripts/check-gift-price-freshness.mjs |   const ok = age < WARN_AGE_DAYS; |   const ok = true;
 * @mutate .github/workflows/staleness-watch.yml |         run: node scripts/check-gift-price-freshness.mjs |         run: echo skipped
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { WARN_AGE_DAYS, committedPriceAts, priceFreshness } from "../../scripts/check-gift-price-freshness.mjs";
import { PRICE_MAX_AGE_DAYS } from "../../scripts/giftGuidePrice.mjs";

const ROOT = resolve(__dirname, "../..");

describe("gift guide prices raise an alert before they hide (holiday audit D M4)", () => {
  it("warns two days in, a day before any price hides", () => {
    expect(PRICE_MAX_AGE_DAYS).toBe(3);
    expect(WARN_AGE_DAYS).toBe(2);
    expect(priceFreshness(["2026-11-20", "2026-11-19"], "2026-11-20").ok).toBe(true);
    expect(priceFreshness(["2026-11-20", "2026-11-19"], "2026-11-21").ok).toBe(true);
    const due = priceFreshness(["2026-11-20", "2026-11-19"], "2026-11-22");
    expect(due.ok).toBe(false);
    expect(due.message).toMatch(/fill_prices\.py/);
    expect(priceFreshness(["2026-11-20"], "2026-11-24")).toMatchObject({ ok: false, shown: 0 });
    expect(priceFreshness([], "2026-11-20").ok).toBe(false);
  });

  it("reads the committed picks (inventory floor) and runs every morning in staleness-watch", () => {
    expect(committedPriceAts(ROOT).length).toBeGreaterThan(100);
    const wf = readFileSync(join(ROOT, ".github/workflows/staleness-watch.yml"), "utf8");
    expect(wf).toContain("run: node scripts/check-gift-price-freshness.mjs");
    expect(wf).toMatch(/schedule:\s*\n\s*- cron:/);
  });
});
