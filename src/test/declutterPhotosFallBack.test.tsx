/**
 * CLASS GUARD (audit 1028, after D1-14): a Declutter listing photo that fails to load steps aside for its placeholder;
 * it never leaves the browser's broken-image box or its alt text on the tile. DeclutterItemCard did this already; the
 * thumbs on Selling, the map preview, Manage listing, the moving-sale and selling-now rows, the share card, the item
 * gallery and the Helpr's route list did not (lead 2026-10-29: "give them the same placeholder fallback").
 *
 * Inventory from source: every <img> in src/components/declutter (tests excluded, comments blanked). Each one either
 * handles onError itself or is a FallbackImg. The exceptions are exact, with their reason: a local preview of a file the
 * member just picked (blob: / object URL, it cannot fail to load from the network) or a signed handover photo shown as
 * evidence, where an empty box would hide that the photo is missing.
 *
 * @mutate src/components/declutter/SellingNowRow.tsx | <FallbackImg src={photoPublicUrl(cover.get(it.id)!)} | <img src={photoPublicUrl(cover.get(it.id)!)}
 * @mutate src/components/declutter/FallbackImg.tsx |   if (stage === "gone" \|\| (stage === "retry" && !retrySrc)) return <>{fallback}</>; |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";
import { fireEvent, render, screen } from "@testing-library/react";
import { FallbackImg } from "@/components/declutter/FallbackImg";

const DIR = resolve(__dirname, "../components/declutter");

/** file -> how many bare <img> it may keep, and why. Exact both ways. */
// @two-way src/test/declutterPhotosFallBack.test.tsx:stale baseline entry
const ALLOWED: Record<string, number> = {
  "DeclutterBunchPile.tsx": 1, // a blob: preview of a photo not sorted yet
  "DeclutterSellPhotos.tsx": 2, // the seller's own photos while listing: an uploaded one, and a blob: preview
  "DeclutterSellView.tsx": 1, // the seller's own draft cover while listing
  "DeclutterHandoverSheets.tsx": 3, // the porch photo and buyer pickup photo previews (object URLs, BUY-5) and the signed "where it was left" photo
  "DeclutterPorchHandover.tsx": 1, // the signed "where it was left" photo (evidence)
  "DeclutterDeliveryViews.tsx": 1, // the signed delivery proof photo (evidence)
};

function bareImgs(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of readdirSync(DIR) as string[]) {
    if (!name.endsWith(".tsx") || name.includes(".test.")) continue;
    const src = blankComments(readFileSync(join(DIR, name), "utf8"));
    const tags = src.match(/<img\b[^>]*>/g) ?? [];
    const bare = tags.filter((t) => !/\bonError=/.test(t)).length;
    if (bare) out[name] = bare;
  }
  return out;
}

describe("Declutter photos fall back to their placeholder", () => {
  it("every <img> handles a failed load, or is an exact, reasoned exception", () => {
    const bare = bareImgs();
    // Floor: the reasoned exceptions are real <img> tags the scan found (an empty read would only list them stale).
    expect(Object.keys(bare).length).toBeGreaterThan(3);
    const problems: string[] = [];
    for (const [file, n] of Object.entries(bare)) {
      if ((ALLOWED[file] ?? 0) < n) problems.push(`${file}: ${n - (ALLOWED[file] ?? 0)} <img> with no onError: use FallbackImg`);
    }
    for (const [file, n] of Object.entries(ALLOWED)) {
      if ((bare[file] ?? 0) < n) problems.push(`stale baseline entry ${file} (${n}, now ${bare[file] ?? 0}) — remove it (lower the baseline)`);
    }
    expect(problems).toEqual([]);
  });

  it("FallbackImg shows its placeholder once the photo fails, and tries a new photo again", () => {
    const { rerender } = render(<FallbackImg src="https://unit-test.invalid/a.jpg" alt="" fallback={<span data-testid="ph" />} />);
    const img = document.querySelector("img")!;
    expect(screen.queryByTestId("ph")).toBeNull();
    fireEvent.error(img);
    expect(screen.getByTestId("ph")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    rerender(<FallbackImg src="https://unit-test.invalid/b.jpg" alt="" fallback={<span data-testid="ph" />} />);
    expect(document.querySelector("img")).not.toBeNull();
  });

  it("the inventory is real: the files it reads use FallbackImg", () => {
    let uses = 0;
    for (const name of readdirSync(DIR) as string[]) {
      if (!name.endsWith(".tsx") || name.includes(".test.")) continue;
      uses += (blankComments(readFileSync(join(DIR, name), "utf8")).match(/<FallbackImg\b/g) ?? []).length;
    }
    expect(uses).toBeGreaterThan(7);
  });
});
