/**
 * L015 (landing audit 11-09): on the item page at 1440 a portrait photo was cropped into the 4:3, height-capped frame,
 * cutting off the product name on the box. From sm the whole photo shows on the frame's ground (object-contain); the
 * phone's square frame keeps the square crop it is served (object-cover).
 *
 * @mutate src/components/declutter/DeclutterGallery.tsx |                 className="h-full w-full object-cover sm:object-contain" |                 className="h-full w-full object-cover"
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

describe("L015: the item photo is shown whole from sm", () => {
  it("the gallery's photo is cover on a phone and contain from sm, and nothing in it is cover-only", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "..", "components/declutter/DeclutterGallery.tsx"), "utf8"));
    const photoClasses = [...src.matchAll(/className="([^"]*\bobject-(?:cover|contain)\b[^"]*)"/g)].map((m) => m[1]);
    expect(photoClasses.length).toBeGreaterThan(0);
    for (const c of photoClasses) {
      const cls = c.split(/\s+/);
      expect(cls).toContain("object-cover");
      expect(cls, c).toContain("sm:object-contain");
    }
  });
});
