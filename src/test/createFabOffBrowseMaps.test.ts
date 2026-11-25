/**
 * CLASS GUARD (deep audit 11-22 #8): the floating create pill never sits on a phone Browse map.
 *
 * SectionCreateFab is fixed bottom-right on the dock's floor (`bottom-safe-nav right-4`). The Jobs phone map puts its
 * my-location button on that same floor and corner (MyLocationCorner, `bottom: MAP_DOCK_CLEARANCE`, right), so
 * "+ Post a job" covered it and a Helpr could not re-center; on the Declutter phone map "+ Sell" covered the main
 * cluster of pins. The pill steps aside (HideSectionCreateFab, the counted hider in createFabHidden.tsx) while a
 * Browse map is on screen.
 *
 * Inventory from source: every file under src/ (tests excluded, comments blanked) that renders a Browse map
 * (`<BrowseMap` or `<DeclutterMap`). Each either mounts `<HideSectionCreateFab` or is listed in NO_PILL with the
 * reason the pill is never on that screen. Both lists are exact both ways.
 *
 * @mutate src/components/dashboard/BrowseTasksFeed.tsx |           <HideSectionCreateFab />\n          {onShowList && | {onShowList &&
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |         <HideSectionCreateFab />\n        <div className="h-[calc(100dvh-19rem)] min-h-[320px]">{map(false)}</div> |         <div className="h-[calc(100dvh-19rem)] min-h-[320px]">{map(false)}</div>
 */
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { readSource, walkSource } from "./helpers/walkSource";

const ROOT = join(__dirname, "../..");
const MAP_TAG = /<(?:BrowseMap|DeclutterMap)\b/;

/** Files that render a Browse map on a screen where the floating create pill is never drawn. */
const NO_PILL: Record<string, string> = {
  // Desktop split-view map column: SectionCreateFab draws nothing on the desktop website (`shown = !desktop && ...`).
  "src/pages/home/DashboardMapColumn.tsx": "desktop only",
  // The signed-out /browse page: no SectionCreateFab is rendered on it (the pill lives in JobsSection / section homes).
  "src/pages/home/DashboardGuest.tsx": "guest page has no create pill",
};

function mapFiles(): { file: string; code: string }[] {
  const out: { file: string; code: string }[] = [];
  for (const full of walkSource([join(ROOT, "src")])) {
    if (/\.test\.tsx?$/.test(full) || full.includes(`${join("src", "test")}/`)) continue;
    const raw = readSource(full);
    if (raw === null) continue;
    const code = blankComments(raw);
    if (MAP_TAG.test(code)) out.push({ file: relative(ROOT, full), code });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

describe("deep audit 11-22 #8: the create pill steps aside on every phone Browse map", () => {
  const files = mapFiles();
  const exempt = new Set(Object.keys(NO_PILL));

  it("the inventory finds the Browse map render sites", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it("every Browse map render site mounts HideSectionCreateFab, or is a screen with no pill", () => {
    const offenders = files.filter((f) => !exempt.has(f.file) && !f.code.includes("<HideSectionCreateFab")).map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  it("NO_PILL is exact: each entry still renders a map and still has no HideSectionCreateFab", () => {
    const found = new Set(files.map((f) => f.file));
    for (const f of exempt) expect({ f, rendersMap: found.has(f) }).toEqual({ f, rendersMap: true });
    for (const f of files.filter((x) => exempt.has(x.file))) expect({ f: f.file, hides: f.code.includes("<HideSectionCreateFab") }).toEqual({ f: f.file, hides: false });
  });

  it("the hider sits on the phone map itself, not elsewhere in the file", () => {
    const feed = files.find((f) => f.file === "src/components/dashboard/BrowseTasksFeed.tsx")!.code;
    expect(feed).toMatch(/view === "map" && \(\s*<div className="relative flex-1 min-h-0 px-3 pt-2 pb-0">\s*(?:\{\s*\}\s*)?<HideSectionCreateFab \/>/);
    const decl = files.find((f) => f.file === "src/components/declutter/DeclutterBrowseView.tsx")!.code;
    expect(decl).toMatch(/<HideSectionCreateFab \/>\s*<div className="h-\[calc\(100dvh-19rem\)\] min-h-\[320px\]">\{map\(false\)\}<\/div>/);
  });
});
