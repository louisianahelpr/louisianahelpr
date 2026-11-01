import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Owner 2026-10-25 (Browse job sheet: "Job price $60 · You take home $56"):
 * "this should never show job price. only what they take home". The one
 * component both Helpr sheets use (the job sheet, Application sent) shows the
 * take-home alone.
 *
 * @mutate src/components/dashboard/helprTakeHome.tsx |       {!fixedPay && <span className="sr-only">Your pay </span>}<span |       Job price {formatPrice(job.budget)} · {!fixedPay && <span className="sr-only">Your pay </span>}<span
 */
const src = readFileSync(resolve(__dirname, "../components/dashboard/helprTakeHome.tsx"), "utf8");

describe("a Helpr sheet shows only the take-home", () => {
  it("JobPriceTakeHome renders no job price", () => {
    const body = src.slice(src.indexOf("export function JobPriceTakeHome"));
    expect(body).not.toMatch(/Job price|job\.budget|formatPrice\(/);
    // Owner 11-01: "Remove you take home": the figure alone, "Your pay" for a screen reader.
    expect(body).toMatch(/Your pay/);
  });
});
