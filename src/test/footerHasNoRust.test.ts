/**
 * Audit #14 (2026-10-21): the footer's column titles and its heart were rust;
 * rust is for money only. Titles are neutral, the heart olive.
 *
 * @mutate src/components/Footer.tsx |               color: "hsl(var(--bark))",\n              fill: "hsl(var(--bark))", |               color: "hsl(var(--burnt-sienna))",\n              fill: "hsl(var(--burnt-sienna))",
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
