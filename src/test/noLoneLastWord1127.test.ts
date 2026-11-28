/**
 * Polish audit 11-27 #107: one word alone on a line ("nearby." on sign up, "one." in the guides hub's 25 Days box,
 * "in." in the trust band, "done." on the landing's Jobs card). Sitewide, paragraphs and list text break "pretty" and
 * headings "balance", in index.css's base layer. Only the longhand `text-wrap-style`: the `text-wrap` shorthand also
 * sets text-wrap-mode, which would undo a truncate / whitespace-nowrap line in the same cascade.
 *
 * @mutate src/index.css |   p, li, dd, figcaption, blockquote { text-wrap-style: pretty; } |   p, li, dd, figcaption, blockquote { }
 * @mutate src/index.css |   h1, h2, h3, h4 { text-wrap-style: balance; } |   h1, h2, h3, h4 { text-wrap: balance; }
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

const css = blankComments(readFileSync("src/index.css", "utf8"));

describe("no lone last word sitewide (#107)", () => {
  const base = css.slice(css.indexOf("@layer base {"), css.indexOf("@media (pointer: coarse)", css.indexOf("@layer base {")));

  it("is not vacuous: the base layer is found", () => {
    expect(base.length).toBeGreaterThan(200);
    expect(base).toContain("body {");
  });

  it("paragraphs break pretty and headings balance, with the longhand only", () => {
    expect(base).toMatch(/p, li, dd, figcaption, blockquote \{ text-wrap-style: pretty; \}/);
    expect(base).toMatch(/h1, h2, h3, h4 \{ text-wrap-style: balance; \}/);
    // The shorthand would reset text-wrap-mode (nowrap lines would wrap): never used for these element rules.
    expect(base).not.toMatch(/\btext-wrap:\s*(pretty|balance)/);
  });
});
