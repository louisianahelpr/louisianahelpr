/*
 * GUARD (owner 11-18, landing design fix: "Make the jobs move down some so you have to scroll to see and the landing
 * view gets the full view also light up the green background look"):
 *  - the signed-out hero fills the whole first screen at EVERY width, phone included, so "Open jobs near you" only
 *    shows after a scroll: .landing-hero-band carries min-height 100vh then 100svh (the fallback first), and the
 *    section has no Tailwind min-h-* of its own that could shorten it again (the 11-08 phone peek,
 *    min-h-[calc(100svh-7.5rem)]); the top bar is drawn over the band, so the full height already counts it;
 *  - the light band is lighter than the 11-18 mockup band it replaced (#dfe3c4 / #eef0de / #faf6ee), stop by stop,
 *    and still reads as green (each stop's green channel above its blue). Text AA on every stop is
 *    landingHeroBand1118.test.ts's.
 *
 * @mutate src/index.css | .landing-page .landing-hero-band { background: var(--lp-hero-band); min-height: 100vh; min-height: 100svh; } | .landing-page .landing-hero-band { background: var(--lp-hero-band); }
 * @mutate src/index.css | .landing-page .landing-hero-band { background: var(--lp-hero-band); min-height: 100vh; min-height: 100svh; } | .landing-page .landing-hero-band { background: var(--lp-hero-band); min-height: 100svh; min-height: 100vh; }
 * @mutate src/components/landing/HeroSection.tsx | <section className="landing-hero-band relative flex flex-col | <section className="landing-hero-band relative flex min-h-[calc(100svh-7.5rem)] sm:min-h-[100svh] flex-col
 * @mutate src/index.css |   --lp-hero-band: linear-gradient(160deg, #eaeed6 0%, #f4f6ea 45%, #fdfaf4 100%); |   --lp-hero-band: linear-gradient(160deg, #dfe3c4 0%, #eef0de 45%, #faf6ee 100%);
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const CSS = blankComments(read("src/index.css"));
const HERO = blankComments(read("src/components/landing/HeroSection.tsx"));
const INDEX = read("index.html");

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = CSS.match(new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : "";
}
function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const OLD_STOPS = ["#dfe3c4", "#eef0de", "#faf6ee"];

describe("landing hero is the whole first screen and its band is lighter (owner 11-18)", () => {
  const section = /<section\s+className="([^"]+)"/.exec(HERO)?.[1] ?? "";

  it("finds the hero section and its band rule", () => {
    expect(section.length).toBeGreaterThan(10);
    expect(rule(".landing-page .landing-hero-band").length).toBeGreaterThan(10);
  });

  it("the band rule's min-height is 100vh then 100svh (fallback first, so svh wins where supported)", () => {
    const decls = [...rule(".landing-page .landing-hero-band").matchAll(/min-height:\s*([^;]+);?/g)].map((m) => m[1].trim());
    expect(decls).toEqual(["100vh", "100svh"]);
  });

  it("the hero section carries the band and no min-h-* class of its own (no phone peek)", () => {
    const classes = section.split(/\s+/);
    expect(classes).toContain("landing-hero-band");
    expect(classes.filter((c) => /(^|:)min-h-/.test(c))).toEqual([]);
  });

  it("index.html's prerendered hero (B100 shell) has the same section, so the first paint is already full-screen", () => {
    expect(INDEX).toContain(`<section class="${section}">`);
    expect(INDEX).not.toContain("min-h-[calc(100svh-7.5rem)]");
  });

  it("every light band stop is lighter than the stop it replaced and still green", () => {
    const m = CSS.match(/(?:^|})\s*\.landing-page\s*\{[^}]*--lp-hero-band:\s*([^;]+);/);
    const stops = [...(m?.[1] ?? "").matchAll(/#[0-9a-f]{6}/gi)].map((x) => x[0]);
    expect(stops.length).toBe(3);
    stops.forEach((s, i) => {
      expect(lum(s), `${s} vs ${OLD_STOPS[i]}`).toBeGreaterThan(lum(OLD_STOPS[i]));
    });
    // The first two stops carry the green (the third is the cream the page fades into).
    for (const s of stops.slice(0, 2)) expect(parseInt(s.slice(3, 5), 16), `${s} green over blue`).toBeGreaterThan(parseInt(s.slice(5, 7), 16));
  });
});
