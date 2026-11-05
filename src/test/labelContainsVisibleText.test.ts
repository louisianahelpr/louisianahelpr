/**
 * ui-sweep #3491 (11-05): axe-core 4.14 turned on label-content-name-mismatch (WCAG 2.5.3, "Label in
 * Name"): a control's accessible name must contain the words it shows, or a voice user who says what
 * they see ("click Coming to you") hits nothing. The empty-state sweep went red on three controls:
 *   - YouCard's photo button: aria-label "View my public profile" over a monogram ("SC"). It repeats
 *     the "View my public profile" text button beside it, so it leaves the tab order and the tree.
 *   - MoneyTile (Money tab, Payment tab, /home): aria-label "Coming to you: $0.00. ..." over the same
 *     words with different punctuation. No aria-label now: the tile's own words are its name.
 *   - DeclutterSellerCard (Declutter item, job page Helpr/poster card): aria-label "See the Helpr,
 *     Eli R., 4.9 stars from 11 reviews" over "ER Eli R. 4.9 · 11 reviews Joined June 2025". Loaded,
 *     the card's words are its name, with an sr-only "See the Helpr, " first; the monogram is hidden.
 *
 * @mutate src/components/profile/profileLanding/YouCard.tsx | className="btn-press relative shrink-0 rounded-full" aria-hidden="true" tabIndex={-1}> | className="btn-press relative shrink-0 rounded-full">
 * @mutate src/pages/home/homeDashboard/HomeMoneyTiles.tsx |       data-money-tile={kind} |       data-money-tile={kind} aria-label={`${label}: ${amount}. ${caption}`}
 * @mutate src/components/declutter/DeclutterSellerCard.tsx | aria-label={loading ? `See the ${noun}` : undefined} | aria-label={loading ? `See the ${noun}` : `See the ${noun}, ${name}`}
 * @mutate src/components/declutter/DeclutterSellerCard.tsx | <span aria-hidden="true" className="contents"> | <span className="contents">
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", p), "utf8"));

/** The opening tag (through its first unquoted `>`) of the first element whose text starts at `from`. */
function openingTag(src: string, from: number): string {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return src.slice(from, i + 1);
  }
  throw new Error("unterminated tag");
}

describe("#3491: a control's accessible name contains the words it shows (WCAG 2.5.3)", () => {
  it("YouCard's photo button is out of the tab order and the tree (it repeats the text button)", () => {
    const src = read("components/profile/profileLanding/YouCard.tsx");
    const at = src.indexOf('<button type="button" onClick={open}');
    expect(at).toBeGreaterThan(-1);
    const tag = openingTag(src, at);
    expect(tag).toContain('aria-hidden="true"');
    expect(tag).toContain("tabIndex={-1}");
    // The text button it repeats is still there, with its words as its name.
    expect(src).toMatch(/>\s*View my public profile\s*<\/Button>/);
  });

  it("MoneyTile has no aria-label: its label, amount and caption are its name", () => {
    const src = read("pages/home/homeDashboard/HomeMoneyTiles.tsx");
    const at = src.indexOf("function MoneyTile(");
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf("\n}\n", at));
    const tag = openingTag(body, body.indexOf("<button"));
    expect(tag).toContain("data-money-tile={kind}");
    expect(tag).not.toMatch(/aria-label/);
  });

  it("DeclutterSellerCard: loaded, the card's words are its name; the monogram is hidden", () => {
    const src = read("components/declutter/DeclutterSellerCard.tsx");
    const tag = openingTag(src, src.indexOf("<Link"));
    expect(tag).toContain("aria-label={loading ? `See the ${noun}` : undefined}");
    expect(src).toMatch(/<span aria-hidden="true" className="contents">\s*<UserAvatar /);
    expect(src).toContain('<span className="sr-only">See the {noun}, </span>');
  });

  it("inventory: the three controls this guard reads still exist", () => {
    const files = [
      "components/profile/profileLanding/YouCard.tsx",
      "pages/home/homeDashboard/HomeMoneyTiles.tsx",
      "components/declutter/DeclutterSellerCard.tsx",
    ].filter((f) => read(f).length > 0);
    expect(files.length).toBeGreaterThan(2);
  });
});
