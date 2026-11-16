/**
 * L3, title half (iOS design audit 2026-11-16): popup titles drifted on a phone: 20px on the Create and Filter sheets
 * (SheetHero, SHEET_HERO_TITLE_CLASS = text-headline-section, --headline-section 20px) against 19.2px on the job
 * detail sheet (DialogHero: clamp(1.2rem, 1.6vw + 0.4rem, 1.45rem) bottoms out at 1.2rem below ~800px). DialogHero's
 * floor is now the same token, so every popup title is 20px on a phone; its desktop growth (to 1.45rem) is unchanged.
 * (The rest of L3, an eyebrow + subtitle stack and a drag bar, is the opposite of owner decisions: eyebrows deleted
 * 2026-09-02, every sheet keeps the X only with no drag bar 2026-10-31.)
 *
 * @mutate src/components/ui/dialog.tsx | "clamp(var(--headline-section), 1.6vw + 0.4rem, 1.45rem)" | "clamp(1.2rem, 1.6vw + 0.4rem, 1.45rem)"
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { Dialog, DialogContent, DialogHero } from "@/components/ui/dialog";
import { SHEET_HERO_TITLE_CLASS } from "@/components/ui/sheetHeroTitle";
import { blankComments, blankCssComments } from "@/test/helpers/blankNonCode";

describe("L3: one popup title size on a phone", () => {
  it("SheetHero's title is the --headline-section token, and that token is 20px", () => {
    expect(SHEET_HERO_TITLE_CLASS.split(/\s+/)).toContain("text-headline-section");
    const css = blankCssComments(readFileSync("src/index.css", "utf8"));
    expect(css).toMatch(/\.text-headline-section\s*\{\s*font-size:\s*var\(--headline-section\);/);
    expect(css).toMatch(/--headline-section:\s*20px;/);
  });

  it("DialogHero's title never goes below that same token", () => {
    render(<Dialog open><DialogContent aria-describedby={undefined}><DialogHero title="Help move furniture" /></DialogContent></Dialog>);
    const h = screen.getByRole("heading", { name: "Help move furniture" });
    const src = blankComments(readFileSync("src/components/ui/dialog.tsx", "utf8"));
    // Read from source as well as the DOM: jsdom may drop a clamp() it cannot parse.
    const sizes = [...src.matchAll(/fontSize:\s*moment\s*\?\s*"[^"]*"\s*:\s*"([^"]*)"/g)].map((m) => m[1]);
    expect(sizes.length).toBeGreaterThan(0);
    for (const s of sizes) expect(s).toMatch(/^clamp\(var\(--headline-section\),/);
    const inline = h.getAttribute("style") ?? "";
    if (/font-size/.test(inline)) expect(inline).toMatch(/clamp\(var\(--headline-section\)/);
  });
});
