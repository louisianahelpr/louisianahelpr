/**
 * Money > Spent's reads (src/lib/declutter/purchaseSpend.ts and every src/lib/declutter module it imports) sit on
 * the first screen of /profile?tab=earnings and, through the spent-reads chunk, of /declutter. On the L33 train
 * (11-02) refundedCents.ts joined them with a STATIC import of lifecycleErrors.ts and was not in the spent-reads
 * chunk, so it landed in signed-in-deep and pulled signed-in-deep, signed-in-pages, declutter-first-screen and three
 * more chunks onto those routes: earnings 386 -> 509 KB gz and 6 -> 8 rounds, /declutter 468 -> 531, selling
 * 555 -> 597 (scripts/perf/critical-path.mjs, Q178). Measured after the fix: 387 / 6 rounds, 471, 559.
 *
 * CLASS (from source): every src/lib/declutter module purchaseSpend.ts statically imports (and purchaseSpend itself)
 * is named by vite.config.ts's spent-reads chunk, and none of them statically imports lifecycleErrors (load it on a
 * failure with import(), as paidCents.ts does).
 *
 * @mutate src/lib/declutter/refundedCents.ts |     const copy = await import("@/lib/lifecycleErrors").catch( | import { rpcErrorMessage as _r } from "@/lib/lifecycleErrors"; void _r;\n    const copy = await import("@/lib/lifecycleErrors").catch(
 * @mutate vite.config.ts | (purchaseSpend\|paidCents\|refundedCents) | (purchaseSpend\|paidCents)
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const DIR = "src/lib/declutter/";
const STATIC_DECLUTTER = /^\s*import\s+(?!type\b)[^;]*?from\s*["']@\/lib\/declutter\/(\w+)["']/gm;
const STATIC_LIFECYCLE = /^\s*import\s+(?!type\b)[^;]*?from\s*["']@\/lib\/lifecycleErrors["']/m;

function spentModules(): string[] {
  const src = blankComments(readFileSync(`${DIR}purchaseSpend.ts`, "utf8"));
  return ["purchaseSpend", ...[...src.matchAll(STATIC_DECLUTTER)].map((m) => m[1])];
}

describe("Money > Spent's reads stay in the small spent-reads chunk (critical-path budget, Q178)", () => {
  it("finds purchaseSpend's own declutter imports", () => {
    expect(spentModules().length).toBeGreaterThanOrEqual(3);
  });

  it("none of them statically imports lifecycleErrors", () => {
    const bad = spentModules().filter((m) => STATIC_LIFECYCLE.test(blankComments(readFileSync(`${DIR}${m}.ts`, "utf8"))));
    expect(bad).toEqual([]);
  });

  it("vite.config.ts's spent-reads chunk names every one of them", () => {
    const cfg = blankComments(readFileSync("vite.config.ts", "utf8"));
    const m = cfg.match(/name:\s*"spent-reads",\s*test:\s*\/(.+)\/,/);
    expect(m, "spent-reads group not found").not.toBeNull();
    const re = new RegExp(m![1]);
    const missing = spentModules().filter((mod) => !re.test(`/src/lib/declutter/${mod}.ts`));
    expect(missing).toEqual([]);
  });
});
