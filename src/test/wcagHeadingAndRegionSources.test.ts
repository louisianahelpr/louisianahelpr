// @mutate src/lib/celebrate.ts |   canvas.setAttribute("aria-hidden", "true"); |   canvas.setAttribute("data-x", "true");
// @mutate src/pages/postjob/firstPostConfetti.ts |     await fireConfetti({ |     const confetti = (await import("canvas-confetti")).default; confetti({
// @mutate src/components/Footer.tsx | </h2> | </h3>
// @mutate src/components/wallet/PayoutCelebration.tsx | className="font-display italic font-bold leading-tight text-ds-18" | role="heading" aria-level={3} className="font-display italic font-bold leading-tight text-ds-18"
/*
 * SOURCE side of the Q212 WCAG fixes (docs/OPEN.md). The prod axe sweep
 * (a11y-webkit-prod.yml, two-way baseline e2e/happy-path/axe-known-violations.json)
 * is the end-to-end check; this pins each cause to the one place it lives, so a
 * regression fails on every push instead of three times a week against prod.
 *
 *  - region (/profile?tab=earnings, helper): canvas-confetti's bare call appends
 *    a full-screen <canvas> to <body>, outside every landmark. Every confetti
 *    burst now goes through fireConfetti(), whose canvas is aria-hidden.
 *  - heading-order (/support, /payment-success x2, 404): the shared Footer's
 *    column titles were <h3> under a page whose outline is only an H1. The
 *    footer follows ANY page, so its titles are <h2>.
 *  - heading-order (/profile?tab=earnings|payment, helper): PayoutCelebration's
 *    "You earned $X" was an <h3> between the tab's H1 and its first H2. It is a
 *    transient role="status" line, not a section, so it carries no heading.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "test") walk(p, out); }
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("Q212: WCAG heading-order / region causes stay fixed at the source", () => {
  it("every confetti burst goes through fireConfetti, and its canvas is aria-hidden", () => {
    const files = walk(resolve(ROOT, "src")).map((f) => [relative(ROOT, f), blankComments(readFileSync(f, "utf8"))] as const);
    expect(files.length).toBeGreaterThan(200);
    const importers = files.filter(([, s]) => /["']canvas-confetti["']/.test(s)).map(([f]) => f);
    expect(importers).toEqual(["src/lib/celebrate.ts"]);
    const callers = files.filter(([, s]) => /\bfireConfetti\(/.test(s)).map(([f]) => f);
    expect(callers.length).toBeGreaterThan(1);
    const celebrate = read("src/lib/celebrate.ts");
    const fn = celebrate.slice(celebrate.indexOf("export async function fireConfetti"));
    expect(fn).toMatch(/canvas\.setAttribute\("aria-hidden", "true"\)/);
    expect(fn).toMatch(/confetti\.create\(canvas/);
    // Only ONE bare confetti call site may exist: the create() inside fireConfetti.
    expect((celebrate.match(/\bconfetti\(/g) ?? []).length).toBe(0);
  });

  it("the shared Footer's titles are <h2>, never deeper (it follows any page's H1)", () => {
    const footer = read("src/components/Footer.tsx");
    expect((footer.match(/<h2\b/g) ?? []).length).toBeGreaterThan(2);
    expect(footer).not.toMatch(/<\/?h[3-6]\b/);
  });

  it("PayoutCelebration (a role=status line) renders no heading", () => {
    const s = read("src/components/wallet/PayoutCelebration.tsx");
    expect(s).toMatch(/role="status"/);
    expect(s).not.toMatch(/<\/?h[1-6]\b/);
    expect(s).not.toMatch(/role="heading"/);
  });
});
