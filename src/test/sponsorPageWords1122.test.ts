// @mutate src/content/sponsorPage.ts | prize: "B.Skin Tight marine collagen + electrolyte drink" | prize: "Active Beauty product"
// @mutate src/content/sponsorPage.ts | showAll: "Show all {n} sponsors" | showAll: "Show all {n} partners"
// @mutate src/pages/sponsor/sponsor.css | a.lh25-lineup-brand { display: inline-flex; align-items: center; min-height: 44px; } | a.lh25-lineup-brand { display: inline-flex; align-items: center; min-height: 26px; }
// @mutate src/pages/sponsor/sponsor.css | .lh25-business-ask a { color: var(--ox); font-weight: 700; white-space: nowrap; } | .lh25-business-ask a { color: var(--ox); font-weight: 700; }
// @mutate src/pages/sponsor/sponsor.css | margin: 40px auto 8px; padding: 0 16px; | margin: 40px auto 8px;
/**
 * Guides polish audit 1122 #24: /25days calls them sponsors everywhere (the button said "partners"), the "Become a
 * sponsor ->" line keeps its arrow with its words and 16px from the screen edge, and a sponsor name that links is a
 * 44px tap target.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/pages/sponsor/sponsor.css", "utf8");
const copy = readFileSync("src/content/sponsorPage.ts", "utf8");

describe("/25days words and tap targets (audit 1122 #24)", () => {
  it("the show-all button says sponsors", () => {
    expect(copy).toContain('showAll: "Show all {n} sponsors"');
  });
  it("the become-a-sponsor line has 16px side space and its arrow stays with its words", () => {
    expect(css).toMatch(/\.lh25-business-ask \{[^}]*padding: 0 16px;/);
    expect(css).toMatch(/\.lh25-business-ask a \{[^}]*white-space: nowrap;/);
  });
  it("Active Beauty's prize is the real one from the tracker", () => {
    expect(copy).toContain('brand: "Active Beauty", prize: "B.Skin Tight marine collagen + electrolyte drink"');
  });
  it("a linked sponsor name is 44px tall", () => {
    expect(css).toMatch(/a\.lh25-lineup-brand \{[^}]*min-height: 44px;/);
  });
});
