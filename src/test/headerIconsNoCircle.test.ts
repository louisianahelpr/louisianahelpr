/**
 * App audit 11-23 H3 (repeat of 1122 #7; owner 11-21 "search is an icon", no circles on header icons): the Jobs header's
 * Search and Filters icons wore a tinted disc with a ring while on, and the map toggle a tinted disc while the map
 * showed (always, at 1440, where the map is on by default). Declutter's Filters icon was already plain.
 *
 * Class guard over every Browse header icon file: no resting background fill and no ring on any state. Only a hover
 * tint (`hover:` / `ctl-tint`) and the focus ring (`focus-visible:`) are allowed.
 *
 * @mutate src/components/dashboard/browseTasksToolbar/BrowseTasksActions.tsx | const HEADER_ICON_ON = "ctl-tint text-[hsl(var(--bark))]"; | const HEADER_ICON_ON = "bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))] ring-1 ring-inset";
 * @mutate src/components/dashboard/browseTasksToolbar/MapToggleButton.tsx |           ? "ctl-tint text-[hsl(var(--bark))]" |           ? "text-[hsl(var(--bark))] bg-[hsl(var(--bark)/0.10)]"
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | filter={<FiltersIconButton plain open={filtersOpen} | filter={<FiltersIconButton open={filtersOpen}
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const DIR = resolve(__dirname, "../components/dashboard/browseTasksToolbar");
const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx") && !f.includes(".test.") && f !== "BrowseSearchBar.tsx");

/** Class tokens that paint a disc or edge on an icon button at rest or while on. */
const CIRCLE = /(?<![\w:!-])(?:bg-\[hsl\(var\(--bark\)|ring-1\b|ring-inset\b|ring-\[hsl\(var\(--bark\))/g;

describe("H3: Browse header icons have no circle", () => {
  it("reads every header icon file (floor)", () => {
    expect(files.length).toBeGreaterThan(3);
    expect(files).toEqual(expect.arrayContaining(["BrowseTasksActions.tsx", "MapToggleButton.tsx", "FiltersIconButton.tsx"]));
  });

  it.each(files)("%s: no resting fill or ring (hover tint and focus ring only)", (f) => {
    let src = blankComments(readFileSync(resolve(DIR, f), "utf8"));
    // FiltersIconButton keeps its old look behind `plain = false`; every caller passes plain (checked below).
    if (f === "FiltersIconButton.tsx") src = src.replace(/: on\n\s*\? "[^"]*"\n\s*: "[^"]*";/, ": \"\";");
    expect(src.match(CIRCLE) ?? []).toEqual([]);
  });

  it("every FiltersIconButton caller asks for the plain icon", () => {
    const view = blankComments(readFileSync(resolve(__dirname, "../components/declutter/DeclutterBrowseView.tsx"), "utf8"));
    const uses = view.match(/<FiltersIconButton\b[^>]*>/g) ?? [];
    expect(uses.length).toBeGreaterThan(1);
    for (const u of uses) expect(u).toMatch(/<FiltersIconButton plain\b/);
  });
});
