/**
 * NIGHT-BUYINGpresse-1 (audit 10-30 night, measured at 375): in the full-screen photo viewer, Previous photo could
 * not be pressed. The arrow comes BEFORE the image in the DOM, and the image carries a transform (pinch zoom), so
 * a phone-wide photo painted over it: the element at the arrow's centre was the IMG. Next (after the image) worked.
 * Both arrows were also pale white glass, nearly invisible on a light photo.
 *
 * jsdom cannot paint, so this reads the source, comments blanked: both arrow buttons carry a z-index class and a
 * dark backing, and the image still sits between them (the order that caused it).
 * @mutate src/components/dashboard/PhotoLightbox.tsx |               className="absolute z-10 left-3 sm:left-6 |               className="absolute left-3 sm:left-6
 * @mutate src/components/dashboard/PhotoLightbox.tsx |               className="absolute z-10 right-3 sm:right-6 |               className="absolute right-3 sm:right-6
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(resolve(__dirname, "../../src/components/dashboard/PhotoLightbox.tsx"), "utf8"));

function arrow(label: string): string {
  const at = src.indexOf(`aria-label="${label}"`);
  expect(at, label).toBeGreaterThan(0);
  return src.slice(at, src.indexOf("</button>", at));
}

describe("photo viewer arrows paint above the photo (NIGHT-BUYINGpresse-1)", () => {
  it("reads the real viewer: the image is transformed and sits between the two arrows", () => {
    // Floor: the real viewer, not a stub.
    expect(src.length).toBeGreaterThan(2000);
    const prev = src.indexOf('aria-label="Previous photo"');
    const img = src.indexOf("alt={`Photo ${lightboxIndex + 1}`}");
    const next = src.indexOf('aria-label="Next photo"');
    expect(prev).toBeGreaterThan(0);
    expect(img).toBeGreaterThan(prev);
    expect(next).toBeGreaterThan(img);
    expect(src.slice(img, next)).toContain("transform: `translate(");
  });

  it.each(["Previous photo", "Next photo"])("%s has a z-index above the image and a dark backing", (label) => {
    const a = arrow(label);
    expect(a).toMatch(/className="[^"]*\bz-(10|20|30|40|50)\b/);
    expect(a).toContain('backgroundColor: "rgba(0, 0, 0, 0.45)"');
  });
});
