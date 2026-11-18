/**
 * Owner 2026-11-17: the logged-out landing's headings (the hero H1, the section H2s, the closing heading, the Live
 * jobs and Declutter strip titles) are drawn in the SAME sans heading face the signed-in app uses for its page titles
 * (.text-page-title: Montserrat 650, upright, -0.02em), not Bodoni Moda. Only the face, weight and tracking changed;
 * sizes, words and layout did not. The /sponsor (25 Days) page keeps its own Christmas type.
 *
 * Read from index.css (comments blanked): the one rule that styles the landing's font-display headings names
 * Montserrat with !important and covers both .landing-serif and .landing-h1, and no Bodoni stack is left on either.
 *
 * @mutate src/index.css | :root .font-display.landing-serif,\n:root .font-display.landing-h1,\n.landing-serif-text {\n  font-family: Montserrat, | :root .font-display.landing-serif,\n:root .font-display.landing-h1,\n.landing-serif-text {\n  font-family: "Bodoni Moda",
 * @mutate src/index.css | :root .font-display.landing-h1,\n | 
 * @mutate src/index.css |   font-weight: 650 !important;\n  letter-spacing: -0.02em !important;\n}\n\n/* D002 | font-weight: 600 !important;\n  letter-spacing: -0.02em !important;\n}\n\n/* D002
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankCssComments, blankComments } from "./helpers/blankNonCode";

const css = blankCssComments(readFileSync("src/index.css", "utf8"));

/** The declaration block of the first rule whose selector list contains `sel`. */
function blockFor(sel: string): string {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(",").map((x) => x.trim());
    if (sels.includes(sel)) return m[2];
  }
  return "";
}

describe("the landing's headings are the app's sans heading face (owner 2026-11-17)", () => {
  it("one rule styles .landing-serif and .landing-h1 headings: Montserrat 650, upright, -0.02em, like .text-page-title", () => {
    const page = blockFor(".text-page-title");
    expect(page).toMatch(/font-family:\s*Montserrat,/);
    for (const sel of [":root .font-display.landing-serif", ":root .font-display.landing-h1", ".landing-serif-text"]) {
      const b = blockFor(sel);
      expect(b, sel).toMatch(/font-family:\s*Montserrat, "Montserrat Fallback", system-ui, -apple-system, sans-serif !important;/);
      expect(b, sel).toMatch(/font-weight:\s*650 !important;/);
      expect(b, sel).toMatch(/letter-spacing:\s*-0\.02em !important;/);
      expect(b, sel).toMatch(/font-style:\s*normal !important;/);
    }
  });

  it("no landing heading rule names Bodoni, and every landing heading still carries one of those classes", () => {
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/landing-(serif|h1|h2)/.test(m[1])) expect(m[2], m[1].trim()).not.toMatch(/Bodoni/);
    }
    const files = ["HeroSection", "SectionsShowcase", "HowItWorksSection", "LiveJobsSection", "LandingBrowseShell"].map(
      (f) => blankComments(readFileSync(`src/components/landing/${f}.tsx`, "utf8")),
    );
    const headings = files.flatMap((src) => src.match(/<h[12][^>]*className="[^"]*(?:font-display|landing-serif-text)[^"]*"/g) ?? []);
    expect(headings.length).toBeGreaterThan(4);
    for (const h of headings) expect(h, h).toMatch(/landing-serif|landing-h1/);
  });
});
