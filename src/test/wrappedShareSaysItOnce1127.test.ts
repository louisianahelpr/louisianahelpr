/**
 * Polish audit 11-27 #134 (Wrapped half): the Share button ("Share your year") had a caption under it saying the same
 * thing again ("Share it with the community"). The button says it once.
 *
 * @mutate src/pages/profile/HelprWrapped.tsx |               </Button>\n              {/* Polish audit 11-27 #134 |               </Button>\n              <p className="text-center text-ds-11 font-sans">Share it with the community</p>\n              {/* Polish audit 11-27 #134
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

const wrapped = blankComments(readFileSync("src/pages/profile/HelprWrapped.tsx", "utf8"));

describe("Wrapped's Share button is not captioned with the same words (#134)", () => {
  it("is not vacuous: the share button is found", () => {
    expect(wrapped).toContain('"Share your year"');
    expect(wrapped).toContain("handleShare()");
  });

  it("no second line repeating the share ask", () => {
    expect(wrapped).not.toMatch(/Share it with the community/);
    const after = wrapped.slice(wrapped.indexOf('"Share your year"'), wrapped.indexOf("</ProfileTabBody>"));
    expect(after).not.toMatch(/<p\b/);
  });
});
