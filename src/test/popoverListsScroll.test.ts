/**
 * A POPOVER THAT RENDERS A LIST SCROLLS INSIDE ITSELF.
 *
 * Radix positions `PopoverContent` with position: fixed, so a panel taller than
 * the room below its trigger runs off the screen and page scroll cannot bring
 * the rest back. press-every-control run 39014836855 (leg 3, 375 wide, prod,
 * 2026-10-17) failed 9 presses on /profile?tab=saved_helpers: the "Filter by
 * skill" panel lists every job category (25 rows, ~930px) and "Welding" to
 * "Other" were outside the viewport. A Helpr's poster could not filter by them.
 *
 * Every `<PopoverContent>` whose body maps over a list must therefore cap its
 * height and scroll (`max-h-…` plus `overflow-y-auto`), unless the list is a
 * short fixed one named in SHORT_LISTS with why. SHORT_LISTS is exact both
 * ways: a bounded or removed entry fails as stale.
 */
import { readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

// @mutate src/components/profile/SavedHelpersTab.tsx | max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain | overscroll-contain
// @mutate src/test/popoverListsScroll.test.ts | "3 fixed sort orders",\n  "components/profile/SavedHelpersTab.tsx | "3 fixed sort orders",\n  "components/profile/SavedHelpersTabX.tsx

const ROOT = resolve(__dirname, "..");

/** `<file under src>::<mapped expression>` -> why it may stay unbounded. */
const SHORT_LISTS: Record<string, string> = {
  "components/profile/ScheduleTab.tsx::UPCOMING_FILTERS": "3 fixed filters (All, Posted, Applied)",
  "components/profile/ReviewsTab.tsx::sortOptions": "3 fixed sort orders",
  "components/profile/SavedHelpersTab.tsx::sortOptions": "the fixed sort orders in savedHelpersTab/types.ts",
  "components/profile/HelperTierBadge.tsx::progress.missing": "the next tier's missing signals from helperTier.ts, at most 3 lines",
  "components/NotificationPanel.tsx::groupedNotifications": "screen-anchored band: screenPanelContentProps (ui/anchoredPanel.tsx) sets its maxHeight from useScreenPanelBand",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "test") walk(p, out);
    } else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

/** The opening tag: from `<PopoverContent` to the first `>` outside braces. */
function openingTag(src: string, at: number): string {
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(at, i + 1);
  }
  return src.slice(at);
}

type Panel = { where: string; key: string | null; bounded: boolean };

const panels: Panel[] = [];
for (const file of walk(ROOT)) {
  const src = blankComments(readFileSync(file, "utf8"));
  const re = /<PopoverContent\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const tag = openingTag(src, m.index);
    const end = src.indexOf("</PopoverContent>", m.index);
    const body = end > 0 ? src.slice(m.index + tag.length, end) : "";
    const mapped = /([\w.]+)\.map\(/.exec(body)?.[1] ?? null;
    const rel = relative(ROOT, file);
    panels.push({
      where: `${rel}:${src.slice(0, m.index).split("\n").length}`,
      key: mapped ? `${rel}::${mapped}` : null,
      bounded: /\bmax-h-/.test(tag) && /\boverflow-(y-)?auto\b/.test(tag),
    });
  }
}

describe("popover lists scroll inside the panel", () => {
  it("finds the app's popovers, some of them lists", () => {
    expect(panels.length).toBeGreaterThan(10);
    expect(panels.filter((p) => p.key).length).toBeGreaterThan(4);
  });

  it("every popover that maps a list caps its height and scrolls, or is a named short list", () => {
    const bad = panels.filter((p) => p.key && !p.bounded && !(p.key in SHORT_LISTS)).map((p) => `${p.where} (${p.key})`);
    expect(bad, "add max-h-[var(--radix-popover-content-available-height)] overflow-y-auto").toEqual([]);
  });

  it("SHORT_LISTS is exact: every entry is a list popover that is still unbounded", () => {
    const live = new Set(panels.filter((p) => p.key && !p.bounded).map((p) => p.key));
    expect(Object.keys(SHORT_LISTS).filter((k) => !live.has(k)), "stale SHORT_LISTS entries").toEqual([]);
  });
});
