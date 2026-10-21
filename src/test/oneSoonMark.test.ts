/**
 * Audit #3 (2026-10-21): a switched-off section wore five different marks
 * (a bordered pill, plain "Opening soon", plain "Soon", a tiny badge, ink text).
 * Every listing now draws THE one SoonPill.
 *
 * @mutate src/components/DesktopSidebarNav.tsx |                   <SoonPill variant="short" aria-hidden="true" className="ml-auto" /> |                   <span className="ml-auto">Soon</span>
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const FILES = [
  "src/components/DesktopSidebarNav.tsx",
  "src/components/sections/ExploreSwitcher.tsx",
  "src/components/create/CreateSheet.tsx",
  "src/components/profile/SettingsTab.tsx",
  "src/components/sections/CustomizeSheet.tsx",
];

describe("one Soon mark", () => {
  it("walks every listing (floor: 5 files on 2026-10-21)", () => {
    expect(FILES.length).toBeGreaterThan(4);
  });

  it.each(FILES)("%s draws SoonPill and no hand-made soon label", (f) => {
    const s = blankComments(readFileSync(join(ROOT, f), "utf8"));
    expect(s).toMatch(/<SoonPill\b/);
    expect(s).not.toMatch(/>\s*(Opening soon|Soon)\s*</);
  });
});
