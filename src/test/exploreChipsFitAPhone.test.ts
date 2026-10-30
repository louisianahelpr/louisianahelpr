/**
 * THE FOUR EXPLORE CHIPS FIT A 375 PHONE (owner 2026-10-28, phone Explore: "Homes" cut off at 375; the "Coming soon"
 * under each name stays, owner 2026-10-22).
 *
 * Measured (WebKit, local build, three sections saying "Coming soon"; track clientWidth / scrollWidth):
 *   before: chips 38 + 77 + 77 + 77 with 2px gaps: 237/278 at 375, 252/278 at 390, 182/278 at 320.
 *   after:  2px chip padding, no gap, caption 3% tighter: fits at 375 and 390; 320 still scrolls (allowed).
 * The rendered fit is held by the home-chrome e2e at 375 and 1440 (track scrollWidth <= clientWidth on a phone);
 * this guard holds the levers and the type floors, so nobody buys the fit by shrinking the words.
 *
 * A2-L11 (app audit 2026-10-28; owner yes 2026-10-29): three 9px "Coming soon" captions at 375 were under the
 * app's 11px floor. The caption is now "Soon" at 11px (narrower than "Coming soon" at 9px, so the fit holds); the
 * chip's accessible name stays "Declutter, coming soon", and the desktop rail keeps "Coming soon".
 *
 * @mutate src/components/sections/ExploreSwitcher.tsx |         optionClassName="px-0.5 text-ds-11 whitespace-nowrap" |         optionClassName="px-1.5 text-ds-11 whitespace-nowrap"
 * @mutate src/components/sections/ExploreSwitcher.tsx |         className="w-full overflow-x-auto no-scrollbar gap-0" |         className="w-full overflow-x-auto no-scrollbar"
 * @mutate src/components/sections/SoonPill.tsx |       <span {...rest} className={`text-ds-11 font-medium text-muted-foreground ${className}`}> |       <span {...rest} className={`text-ds-9 font-medium text-muted-foreground ${className}`}>
 * @mutate src/components/sections/SoonPill.tsx |         {t("soon.short")}\n      </span>\n    );\n  }\n  if (variant === "rail") { |         {t("soon.full")}\n      </span>\n    );\n  }\n  if (variant === "rail") {
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { en } from "@/lib/i18n/en";

const ROOT = resolve(__dirname, "../..");
const code = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));

describe("the Explore chips fit a 375 phone without shrinking their words (owner 2026-10-28)", () => {
  const sw = code("src/components/sections/ExploreSwitcher.tsx");

  it("the chips are 2px a side with no gap, and the name stays 11px", () => {
    const opt = sw.match(/optionClassName="([^"]+)"/)?.[1] ?? "";
    expect(opt.split(/\s+/)).toEqual(expect.arrayContaining(["px-0.5", "text-ds-11"]));
    const track = sw.match(/tone="quiet"[\s\S]{0,600}?className="([^"]+)"/)?.[1] ?? "";
    expect(track.split(/\s+/)).toEqual(expect.arrayContaining(["gap-0", "overflow-x-auto"]));
  });

  it("'Soon' sits under each closed name at 11px, the app's floor (A2-L11)", () => {
    expect(sw).toContain('<SoonPill variant="caption" data-coming-soon="" />');
    const pill = code("src/components/sections/SoonPill.tsx");
    // The word is the dictionary's (Spanish option, 2026-10-29): en "soon.short" = "Soon".
    expect(pill).toMatch(/variant === "caption"[\s\S]{0,120}?className=\{`text-ds-11 font-medium[^`]*`\}>\s*\{t\("soon\.short"\)\}\s*</);
    expect(en["soon.short"]).toBe("Soon");
    // The accessible name still says it in full.
    expect(sw).toMatch(/ariaLabel: soon \? tr\("nav\.comingSoon", \{ label: name \}\) : name/);
    expect(en["nav.comingSoon"]).toBe("{label}, coming soon");
  });

  it("a chip that is too wide for 320 still scrolls (the fade and reveal stay)", () => {
    expect(sw).toMatch(/className=\{more \? "explore-chips-more" : undefined\}/);
  });
});
