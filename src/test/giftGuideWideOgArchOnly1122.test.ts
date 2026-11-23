/**
 * Owner 2026-11-22, 8:16 PM, on the Facebook preview of /gift-guides/printables/gift-tags: "remove the gift tags from the
 * preview. the previews should not have items or stuff on it. just the arch and background basically. fix all of them
 * bc they are wrong". Every 1200x630 card scripts/gift-guide-wide-og.py draws is the page's gingham and the cream arch
 * (lead, title, divider, LOUISIANA HELPR) and nothing else: the generator has no photo source per page and never reads
 * an image file, so no product cutout, deal photo or printable preview can reach a card.
 *
 * @mutate scripts/gift-guide-wide-og.py |     "gift-tags": ("/gift-guides/printables/gift-tags", "red", "free printables", "Gift Tags"), |     "gift-tags": ("/gift-guides/printables/gift-tags", "red", "free printables", "Gift Tags", lambda: [Image.open("public/printables/tags/a.webp")]),
 * @mutate scripts/gift-guide-wide-og.py |     half = 250 * S |     half = {"products": 200, "none": 250}[kind] * S
 * @mutate scripts/gift-guide-wide-og.py |     return im.resize((1200, 630), Image.LANCZOS) |     im.paste(Image.open("public/x.webp"), (0, 0))\n    return im.resize((1200, 630), Image.LANCZOS)
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WIDE_OG_VERSIONS } from "@/lib/giftGuideWideOg.mjs";
import { blankHashComments } from "./helpers/blankNonCode";

const SCRIPT = "scripts/gift-guide-wide-og.py";

function code(): string {
  return blankHashComments(readFileSync(SCRIPT, "utf8"));
}

/** Each PAGES entry: key -> the raw tuple text between its parentheses. */
function pages(src: string): Map<string, string> {
  const start = src.indexOf("PAGES = {");
  const end = src.indexOf("\n}\n", start);
  expect(start, "PAGES = { not found in the generator").toBeGreaterThan(-1);
  const body = src.slice(start, end);
  const out = new Map<string, string>();
  for (const m of body.matchAll(/^\s*"([\w-]+)":\s*\((.*)\),?\s*$/gm)) out.set(m[1], m[2]);
  return out;
}

describe("gift guide link previews are the arch and the gingham only (owner 2026-11-22, 8:16 PM)", () => {
  it("every page's config is (path, tint, lead, title) as four string literals: no photo source", () => {
    const entries = pages(code());
    expect(entries.size).toBeGreaterThan(15); // 17 measured 2026-11-22
    expect([...entries.keys()].sort()).toEqual(Object.keys(WIDE_OG_VERSIONS).sort());
    for (const [key, tuple] of entries) {
      expect(tuple, `${key}: only four quoted strings, nothing that fetches a picture`).toMatch(
        /^\s*"[^"]*",\s*"[^"]*",\s*"[^"]*",\s*"[^"]*"\s*$/,
      );
    }
  });

  it("the generator never opens an image file and draws every arch at the one words-alone width", () => {
    const src = code();
    expect(src).not.toMatch(/Image\.open\s*\(/);
    expect(src).not.toMatch(/\bphotos\b|\bkind\b/);
    expect(src).toMatch(/^ {4}half = 250 \* S$/m);
    expect(src).toMatch(/^def render\(tint, lead, title\):$/m);
  });
});
