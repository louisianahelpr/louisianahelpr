/**
 * Polish audit 11-27, small Declutter items:
 *  #56 the photo viewer's "View all" was the app's only all-caps button: sentence case, 14px.
 *  #12 (part) the sale card's "Pickup at the door" tips were a bordered box inside the card: plain 14px lines.
 *  #64 the Sell chooser's "More ways:" heading ended in a colon (declutterSellChooser.test.tsx renders it).
 *
 * @mutate src/components/dashboard/PhotoLightbox.tsx | <span className="text-ds-14 font-sans font-semibold" data-lightbox-view-all=""> | <span className="text-ds-11 font-sans font-semibold tracking-[0.04em] uppercase" data-lightbox-view-all="">
 * @mutate src/components/declutter/DeclutterOrderBits.tsx |     <div className="text-ds-14 text-muted-foreground" data-door-tips=""> |     <div className="rounded-xl border border-border p-3 text-xs text-muted-foreground" data-door-tips="">
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", "..", p), "utf8"));
const tagOf = (src: string, marker: string) => {
  const at = src.indexOf(marker);
  expect(at, marker).toBeGreaterThan(-1);
  return src.slice(src.lastIndexOf("<", at), src.indexOf(">", at) + 1);
};

describe("polish audit 11-27: small Declutter fixes", () => {
  it("#56: the photo viewer's View all is sentence case at 14px", () => {
    const tag = tagOf(read("src/components/dashboard/PhotoLightbox.tsx"), "data-lightbox-view-all");
    expect(tag).toContain("text-ds-14");
    expect(tag).not.toMatch(/\buppercase\b|tracking-/);
  });

  it("#12: the door pickup tips are plain lines, no box inside the sale card", () => {
    const tag = tagOf(read("src/components/declutter/DeclutterOrderBits.tsx"), "data-door-tips");
    expect(tag).toContain("text-ds-14");
    expect(tag).not.toMatch(/\bborder\b|rounded-|\bp-\d/);
  });
});
