import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * iOS Safari zooms the page when a field under 16px is focused and never zooms
 * back. The (pointer: coarse) guard in index.css lifts every field to 16px,
 * but only if each selector outweighs a one-class text-size utility
 * (`text-ds-14`): a bare `textarea` (weight 0,0,1) lost, so the apply message
 * box zoomed the app on the owner's iPhone (2026-10-25, "everything scrolls").
 */
// @mutate src/index.css |     textarea:not([data-zoom-guard-off]),\n    select:not([data-zoom-guard-off]) { |     textarea,\n    select:not([data-zoom-guard-off]) {
const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");

function guardSelectors(): string[] {
  const at = css.indexOf("@media (pointer: coarse) {\n    input:not(");
  expect(at, "the coarse-pointer field guard is missing from index.css").toBeGreaterThan(-1);
  const body = css.slice(at, css.indexOf("{", css.indexOf("input:not(", at)));
  return body.slice(body.indexOf("input:not(")).split(",").map((s) => s.trim()).filter(Boolean);
}

/** Classes, attributes and pseudo-classes (incl. inside :not()) — the "b" in a,b,c. */
const classWeight = (sel: string) => (sel.match(/\[[^\]]+\]|\.[\w-]+|:(?!not\()[\w-]+/g) ?? []).length;

describe("iOS field zoom guard", () => {
  it("covers input, textarea and select", () => {
    const tags = guardSelectors().map((s) => s.match(/^[a-z]+/)?.[0]);
    expect(new Set(tags)).toEqual(new Set(["input", "textarea", "select"]));
  });

  it("every selector outweighs a one-class text-size utility", () => {
    const sels = guardSelectors();
    expect(sels.length).toBeGreaterThanOrEqual(3);
    for (const sel of sels) expect(classWeight(sel), sel).toBeGreaterThanOrEqual(1);
  });
});
