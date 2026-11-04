// Q1816 (lead 11-04: every scheduled e2e-real-backend run since 09-26 failed). Since 10-30 the Full money loop leg
// failed "the card never asked for the after photo" (runs 41038050144, 41623278596): a45ad9f49a (10-29) made the
// photo primary sentence case ("Take after photo", photoPrimaryLabel) and the spec still matched "Take After photo".
// This checks the spec's name against the app's real labels, so the next label move fails here, not on prod weekly.
//
// @mutate e2e/photoAskName.ts | `^(Take ${type} photo\| | `^(Take ${askLabel}\|
// @mutate e2e/prod-lifecycle.spec.ts |   const askName = photoAskName(type); |   const askName = /^Take After photo$/;
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { photoAskName } from "../../e2e/photoAskName";
import { photoPrimaryLabel } from "@/components/job-card/photoPrimaryLabel";

describe("Q1816: the money loop finds the card's proof-photo ask", () => {
  const types = ["before", "after"] as const;
  for (const type of types) {
    const label = type === "before" ? "Before photo" : "After photo";
    it(`${type}: the primary ("${photoPrimaryLabel(label)}") and the chip both match`, () => {
      expect(photoAskName(type).test(photoPrimaryLabel(label))).toBe(true);
      expect(photoAskName(type).test(`${label} — add the ${type} photo for this job`)).toBe(true);
      expect(photoAskName(type).test(photoPrimaryLabel(type === "before" ? "After photo" : "Before photo"))).toBe(false);
    });
  }
  it("prod-lifecycle uses photoAskName", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "..", "..", "e2e/prod-lifecycle.spec.ts"), "utf8"));
    expect(src).toMatch(/const askName = photoAskName\(type\);/);
  });
  it("inventory: both photo types", () => expect(types.length).toBeGreaterThan(1));
});
