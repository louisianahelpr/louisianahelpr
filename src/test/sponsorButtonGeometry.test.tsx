/**
 * /sponsor a11y geometry (2026-11-17): the button-geometry check (e2e/happy-path/buttonGeometry.ts, "requested is
 * not rendered") reported
 *   - the hero "JOIN THE GIVEAWAYS" / "HOW IT WORKS" buttons: asks h-14 (56px), renders 48px. They are the shared
 *     <Button> (default size `h-14`), and the page's `.lh25 .lh25-btn` rule sets `height: auto; min-height: 48px`,
 *     which released the 56px and drew them at 48px. The same rule draws the final CTA and the submit button.
 *   - the day tiles ("December N, X brands joined"): asks min-h-11 (44px), renders 76px. The tile is the shared
 *     <ToggleChip> (`min-h-11`), and a CSS `min-height: 76px` (96px from 640px) beat the class.
 *   - the same sweep, once those were fixed: the delivery radios (shared <NativeRadio>, h-4) drawn 22px by a CSS rule,
 *     the two textareas (shared <Textarea>, min-h-[96px]) held at 48px by the field rule, and axe
 *     label-content-name-mismatch on the tiles (visible "14 brands joined" vs name "December 1, 4 brands joined").
 * The check compares the class with the computed style, so both are fixed at the source: the button rule's min-height
 * is the shared Button's own 56px, and the tile's real height is its class, with no CSS min-height under it.
 *
 * jsdom does not apply sponsor.css, so the CSS half is read from the stylesheet and the class half from the render.
 *
 * @mutate src/pages/sponsor/sponsor.css | gap: 10px; min-height: 56px; padding: 14px 28px; | gap: 10px; min-height: 48px; padding: 14px 28px;
 * @mutate src/pages/sponsor/sponsor.css | .lh25 .lh25-submit { width: 100%; margin-top: 20px; font-size: 15px; } | .lh25 .lh25-submit { width: 100%; margin-top: 20px; font-size: 15px; min-height: 54px; }
 * @mutate src/pages/sponsor/sponsor.css | gap: 4px; min-width: 0; padding: 8px 2px; | gap: 4px; min-height: 76px; min-width: 0; padding: 8px 2px;
 * @mutate src/components/sponsor/ClaimSection.tsx | className={`lh25-tile min-h-[76px] sm:min-h-[96px]${selected | className={`lh25-tile${selected
 * @mutate src/pages/sponsor/sponsor.css | .lh25 input[type="radio"] { min-width: 0; min-height: 0; margin: 0; | .lh25 input[type="radio"] { min-width: 0; min-height: 0; width: 22px; height: 22px; margin: 0;
 * @mutate src/components/sponsor/ClaimSection.tsx | <Textarea className="min-h-12" id={ID.prize} | <Textarea id={ID.prize}
 * @mutate src/components/sponsor/ClaimSection.tsx | <span className="lh25-tile-day">{d}</span>{" "} | <span className="lh25-tile-day">{d}</span>
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { blankCssComments } from "@/test/helpers/blankNonCode";
import { ClaimSection } from "@/components/sponsor/ClaimSection";
import type { SponsorPublicState } from "@/lib/sponsor/types";

const css = blankCssComments(readFileSync(resolve(__dirname, "../pages/sponsor/sponsor.css"), "utf8"));
const buttonSrc = readFileSync(resolve(__dirname, "../components/ui/button.tsx"), "utf8");

/** Every rule whose selector list names `cls`, as [selector, body]. */
function rulesFor(cls: RegExp): Array<[string, string]> {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => cls.test(m[1])).map((m) => [m[1].trim(), m[2]]);
}

const NO_DB: SponsorPublicState = { on: true, greetingBrand: null, dayCounts: {}, maxPerDay: null, wall: [], testimonials: [], stats: {}, hasFounderPhoto: false };

describe("/sponsor buttons render the height their class asks for", () => {
  it("the shared Button's default size is h-14 (56px), the height the hero buttons carry", () => {
    expect(buttonSrc).toMatch(/\n\s*default: "h-14 /);
  });

  it(".lh25 .lh25-btn sets min-height 56px, and no other .lh25-btn / .lh25-submit rule sets a smaller one", () => {
    const base = rulesFor(/\.lh25 \.lh25-btn\s*$/);
    expect(base.length).toBe(1);
    expect(base[0][1]).toMatch(/height:\s*auto/);
    expect(/min-height:\s*(\d+)px/.exec(base[0][1])?.[1]).toBe("56");
    const all = rulesFor(/\.lh25-(btn|submit)\b/);
    expect(all.length).toBeGreaterThan(5);
    for (const [sel, body] of all) {
      const h = /min-height:\s*(\d+)px/.exec(body);
      if (h) expect(Number(h[1]), sel).toBeGreaterThanOrEqual(56);
    }
  });
});

describe("/sponsor day tiles: the class is the height", () => {
  it("no .lh25-tile rule sets a min-height (it would beat the chip's class)", () => {
    const tiles = rulesFor(/\.lh25-tile\s*$/);
    expect(tiles.length).toBeGreaterThan(1);
    for (const [sel, body] of tiles) expect(body, sel).not.toMatch(/min-height/);
  });

  it("each rendered tile carries min-h-[76px] sm:min-h-[96px] and not the chip's 44px min-h-11", () => {
    render(<ClaimSection state={NO_DB} greetingBrand={null} refCode={null} onSubmit={async () => ({ ok: false, kind: "error" })} />);
    const tiles = screen.getAllByRole("button", { name: /^December \d+,/ });
    expect(tiles.length).toBeGreaterThan(24);
    for (const t of tiles) {
      const cls = t.className.split(/\s+/);
      expect(cls).toContain("min-h-[76px]");
      expect(cls).toContain("sm:min-h-[96px]");
      expect(cls).not.toContain("min-h-11");
    }
  });
});

describe("/sponsor form controls: the class is the size", () => {
  it("the radio rule sets no width/height over NativeRadio's h-4 w-4", () => {
    const radio = rulesFor(/input\[type="radio"\]/);
    expect(radio.length).toBeGreaterThan(0);
    for (const [sel, body] of radio) expect(body, sel).not.toMatch(/(^|[;\s])(width|height):/);
  });

  it("the textareas ask min-h-12, the 48px the field rule draws, and each tile's visible text sits in its name", () => {
    expect(/\.lh25-field textarea\s*\{[^}]*min-height:\s*48px/.test(css)).toBe(true);
    const { container } = render(<ClaimSection state={NO_DB} greetingBrand={null} refCode={null} onSubmit={async () => ({ ok: false, kind: "error" })} />);
    const areas = [...container.querySelectorAll("textarea")];
    expect(areas.length).toBeGreaterThan(1);
    for (const a of areas) {
      expect(a.className.split(/\s+/)).toContain("min-h-12");
      expect(a.className).not.toContain("min-h-[96px]");
    }
    const tiles = screen.getAllByRole("button", { name: /^December \d+,/ });
    expect(tiles.length).toBeGreaterThan(24);
    const norm = (t: string) => t.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    for (const t of tiles) expect(norm(t.getAttribute("aria-label") ?? "")).toContain(norm(t.textContent ?? ""));
  });
});
