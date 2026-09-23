/*
 * GUARD (owner, 2026-09-23): nothing but the plain page background shows
 * before the landing page, and the H mark is never drawn in a square box.
 *  - index.html's #boot-loader holds no image (its filter shadow rendered as a
 *    clipped square on iPhone WebKit);
 *  - "/" loads behind LandingPlainFallback, not the generic dashboard-shaped
 *    route skeleton (a guest saw skeleton -> landing, which read as a jump);
 *  - HelprSpinner sizes the 96x82 mark by height with width auto.
 */
// @mutate index.html |       <!-- Owner, 2026-09-23: nothing but the page background |       <img class="boot-mark" src="./src/assets/helpr-logo-256.webp" alt="" />\n        <!-- Owner, 2026-09-23: nothing but the page background
// @mutate src/App.tsx | <PageTransition><Index /></PageTransition>, <LandingPlainFallback />) | <PageTransition><Index /></PageTransition>)
// @mutate src/components/ui/HelprSpinner.tsx |           width: "auto", |           width: size,
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("no brand loader before the landing page", () => {
  it("the boot shell is the plain background: no image or mark inside #boot-loader", () => {
    const html = read("index.html");
    const start = html.indexOf('id="boot-loader"');
    expect(start).toBeGreaterThan(0);
    const end = html.indexOf("</div>", start);
    const shell = html.slice(start, end);
    expect(shell).not.toMatch(/<img|<svg|boot-mark|helpr-logo/i);
  });

  it('"/" loads behind the plain fallback, not the generic route skeleton', () => {
    const app = read("src/App.tsx");
    expect(app).toMatch(/routeEl\(<PageTransition><Index \/><\/PageTransition>, <LandingPlainFallback \/>\)/);
    expect(app).toMatch(/const LandingPlainFallback = \(\) => <div className="min-h-screen bg-premium-page"/);
  });

  it("HelprSpinner never draws the mark in a square box", () => {
    const src = read("src/components/ui/HelprSpinner.tsx");
    expect(src).toMatch(/width: "auto",\s*\n\s*height: size,/);
    expect(src).not.toMatch(/width: size,\s*\n\s*height: size,/);
  });
});
