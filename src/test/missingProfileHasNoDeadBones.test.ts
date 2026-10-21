/**
 * Audit #48 (2026-10-21): /user/<missing id> drew two grey action boxes in the
 * header that never resolved, and a "Go back" that duplicated the header's back
 * arrow. The no-profile states draw no action placeholders; the way on is Jobs.
 *
 * @mutate src/pages/user/UserProfile.tsx |         <PageHeader eyebrow={headerEyebrow} title={headerTitle} meta={headerMeta} />\n        <div className="page-measure | <PageHeader eyebrow={headerEyebrow} title={headerTitle} meta={headerMeta} titleActions={headerActionPlaceholder} />\n        <div className="page-measure
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(join(resolve(__dirname, "..", ".."), "src/pages/user/UserProfile.tsx"), "utf8"));

describe("a missing profile has no dead bones", () => {
  it("the state card's header has no action placeholders", () => {
    const i = src.indexOf("const stateCard =");
    const card = src.slice(i, src.indexOf("</>", i));
    expect(card).not.toMatch(/titleActions=\{headerActionPlaceholder\}/);
  });
  it("its action is the way on, not a second back button", () => {
    expect(src).toMatch(/title="Profile not found"[\s\S]{0,400}Browse jobs/);
    expect(src).not.toMatch(/>\s*Go back\s*</);
  });
});
