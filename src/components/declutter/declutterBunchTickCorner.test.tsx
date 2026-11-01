/**
 * T8 at 375: the middle of a 61 px bunch photo hit its tick, so a tap ticked instead of opening. Every button gets a 44 px
 * floor (:where(button) in index.css), and the tick asked for 28. jsdom has no layout, so this reads the classes that set the
 * box, works out the corner they cover at the photo sizes the grid gives, and checks the centre is outside it. A real
 * browser's elementFromPoint is the tester's: not measured here.
 *
 * @mutate src/components/declutter/DeclutterBunchPhotos.tsx | flex h-[45%] max-h-11 min-h-0 w-[45%] min-w-0 max-w-11 items-start | flex h-7 w-7 items-start
 * @mutate src/components/declutter/DeclutterBunchPhotos.tsx | flex h-[45%] max-h-11 min-h-0 w-[45%] | flex h-[60%] max-h-11 min-h-0 w-[60%]
 * @mutate src/components/declutter/DeclutterBunchPhotos.tsx | grid grid-cols-3 gap-2 sm:grid-cols-6 | grid grid-cols-4 gap-2 sm:grid-cols-6
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "DeclutterBunchPhotos.tsx"), "utf8");
const tick = /data-bunch-tick=\{k\}\s+className="([^"]+)"/.exec(src)?.[1] ?? "";

/** The tick's box on a photo of this size, from its classes, with the 44 px floor unless it opts out (index.css). */
function tickBox(photo: number): { w: number; h: number } {
  const classes = tick.split(/\s+/);
  const side = (axis: "w" | "h", floorClass: string, maxClass: string) => {
    const pct = classes.map((c) => new RegExp(`^${axis}-\\[(\\d+)%\\]$`).exec(c)?.[1]).find(Boolean);
    const fixed = classes.map((c) => new RegExp(`^${axis}-(\\d+)$`).exec(c)?.[1]).find(Boolean);
    let size = pct ? (photo * Number(pct)) / 100 : Number(fixed ?? 0) * 4;
    if (classes.includes(maxClass)) size = Math.min(size, 44);
    if (!classes.includes(floorClass)) size = Math.max(size, 44);
    return size;
  };
  return { w: side("w", "min-w-0", "max-w-11"), h: side("h", "min-h-0", "max-h-11") };
}

describe("a bunch photo's tick is a corner", () => {
  it("reads the tick's own classes (floor)", () => {
    expect(tick.split(/\s+/).length).toBeGreaterThan(3);
    expect(tick).toContain("absolute");
    expect(tick).toContain("right-0");
    expect(tick).toContain("top-0");
  });

  it.each([44, 49, 61, 80, 97, 120])("on a %i px photo the centre opens the photo", (photo) => {
    const { w, h } = tickBox(photo);
    // Anchored top right: it reaches the centre only if it is more than half the photo both ways.
    expect(w > photo / 2 && h > photo / 2).toBe(false);
    expect(Math.min(w, h)).toBeGreaterThan(photo / 3);
  });

  it("the phone grid is 3 across, so photos are larger (T10 at 375: 4 across gave 61 px)", () => {
    expect(src).toContain("grid grid-cols-3 gap-2 sm:grid-cols-6");
  });

  it("is the full 44 px once the photo has room", () => {
    expect(tickBox(120)).toEqual({ w: 44, h: 44 });
  });
});
