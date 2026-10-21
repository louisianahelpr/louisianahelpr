/**
 * Audit 2026-10-21 batch 2, SHELL items fixed here (lead-routed, owner approved):
 *  #38 Jobs settings rows wear neutral icons, not rust (rust is money only);
 *  #43 Saved Helprs: no rust hearts or note boxes;
 *  #37 Money gear: "Money tools", sentence-case items;
 *  #29 My pets: face emojis (the full-body dog read as a cat);
 *  #27 /search: a real empty state, and one focus ring (the pill's).
 *
 * @mutate src/components/profile/profileLanding/workMenuGroup.tsx |   work: "var(--stormy-sky)", |   work: "var(--burnt-sienna)",
 * @mutate src/components/profile/savedHelpersTab/SavedHelperCard.tsx | style={{ color: "hsl(var(--bark))", fill: "hsl(var(--bark))" }} | style={{ color: "hsl(var(--burnt-sienna))", fill: "hsl(var(--burnt-sienna))" }}
 * @mutate src/components/profile/earningsTab/EarningsToolsMenu.tsx | Export for taxes (PDF) | Export for Taxes (PDF)
 * @mutate src/pages/search/SearchPage.tsx | outline-none focus-visible:outline-none font-sans | outline-none font-sans
 * @mutate src/pages/profile/petProfiles/petProfilesHelpers.ts | emoji: "🐶" | emoji: "🐕"
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { SECTION_TINT } from "@/components/profile/profileLanding/workMenuGroup";
import { speciesEmoji } from "@/pages/profile/petProfiles/petProfilesHelpers";

const ROOT = resolve(__dirname, "..", "..");
const read = (f: string) => blankComments(readFileSync(join(ROOT, f), "utf8"));

describe("audit batch 2 SHELL fixes", () => {
  it("#38 Jobs settings tint is neutral", () => {
    expect(SECTION_TINT.work).not.toMatch(/sienna|rust|accent/);
  });
  it("#43 Saved Helprs carries no rust", () => {
    expect(read("src/components/profile/savedHelpersTab/SavedHelperCard.tsx")).not.toMatch(/burnt-sienna|accent-ink/);
  });
  it("#37 Money gear labels are sentence case and named Money", () => {
    const m = read("src/components/profile/earningsTab/EarningsToolsMenu.tsx");
    expect(m).toContain("Money tools");
    expect(m).toContain("Export for taxes (PDF)");
    expect(m).not.toMatch(/Earnings tools|Export for Taxes|Payout Settings/);
  });
  it("#29 dog and cat read as dog and cat", () => {
    expect(speciesEmoji("dog")).toBe("🐶");
    expect(speciesEmoji("cat")).toBe("🐱");
  });
  it("#27 /search has a real empty state and one focus ring", () => {
    const s = read("src/pages/search/SearchPage.tsx");
    expect(s).toMatch(/<EmptyState\s+icon=\{Search\}/);
    expect(s).toContain("outline-none focus-visible:outline-none");
  });
});
