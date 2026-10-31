/**
 * NIGHT-BUYINGrealma-2 (buying night audit 10-30): at 375 the map's pin preview read "Mid-City, Baton Rouge · 2 ..." —
 * the place and the miles shared one truncated line, so the miles, the one number that matters on a map, were cut.
 * The miles now have their own line that never truncates; only the place may be cut. jsdom has no MapKit to open a
 * preview, so this reads the preview's markup (comments blanked).
 * @mutate src/components/declutter/DeclutterMap.tsx | className="block whitespace-nowrap text-ds-12 font-medium text-foreground" data-map-preview-miles="" | className="block truncate text-ds-12 font-medium text-foreground" data-map-preview-miles=""
 * @mutate src/components/declutter/DeclutterMap.tsx | {selected.item.area_label && <span | {false && <span
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const src = blankComments(readFileSync(resolve(process.cwd(), "src/components/declutter/DeclutterMap.tsx"), "utf8"));

describe("NIGHT-BUYINGrealma-2: the map preview never cuts the miles", () => {
  it("the miles are their own line, which never truncates", () => {
    const miles = /<span className="([^"]*)" data-map-preview-miles="">\{milesLabel\(selected\.miles, approximate\)\}<\/span>/.exec(src);
    expect(miles).not.toBeNull();
    expect(miles![1].split(" ")).toContain("whitespace-nowrap");
    expect(miles![1].split(" ")).not.toContain("truncate");
  });
  it("the place is its own line too, and no line joins the place and the miles", () => {
    expect(src).toContain('{selected.item.area_label && <span className="block truncate text-ds-12 text-muted-foreground" title={selected.item.area_label}>{selected.item.area_label}</span>}');
    expect(src).not.toMatch(/\[selected\.item\.area_label, milesLabel\(/);
  });
});
