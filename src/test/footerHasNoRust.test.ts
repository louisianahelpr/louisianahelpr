/**
 * Audit #14 (2026-10-21): the footer's column titles and its heart were rust;
 * rust is for money only. Titles are neutral (the heart went 2026-11-17; the line is "Delcambre, Louisiana").
 *
 * @mutate src/components/Footer.tsx | <p className="text-ds-11 text-[hsl(var(--olivewood))]/80">{w("footer.place" | <p className="text-ds-11 text-[hsl(var(--burnt-sienna))]">{w("footer.place"
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(join(resolve(__dirname, "..", ".."), "src/components/Footer.tsx"), "utf8"));

describe("the footer carries no rust", () => {
  it("no rust token in the footer's styles", () => {
    expect(src).not.toMatch(/--burnt-sienna|--accent-ink|--sienna-ink/);
  });
});
