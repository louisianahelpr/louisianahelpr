/**
 * DECLUTTER PHOTOS ARE ASKED FOR AT THE SIZE THEY DRAW (B77, 2026-11-01, "Nothing slow for users").
 *
 * (a) Selling's listing thumbnail (64 CSS px) and Buying's cart thumbnail (48) ask for the 160 px square transform,
 *     never the full original (356-560 KB each); a failed transform falls back to the original.
 * (b) A Browse card offers the 320 square beside the 480 card photo (srcSet + sizes), so a phone's ~162 px card
 *     takes the smaller one.
 * (c) A URL that is not a public Storage object gets no transform (the place shows it as it is).
 *
 * @mutate src/components/declutter/ListingThumb.tsx | src={squarePhotoUrl(photoPublicUrl(path), THUMB_PHOTO_PX) ?? photoPublicUrl(path)} | src={photoPublicUrl(path)}
 * @mutate src/components/declutter/DeclutterTradeViews.tsx | src={stage === "thumb" ? squarePhotoUrl(photoPublicUrl(path), THUMB_PHOTO_PX) ?? photoPublicUrl(path) : photoPublicUrl(path)} | src={photoPublicUrl(path)}
 * @mutate src/components/declutter/DeclutterItemCard.tsx |             sizes={photoStage === "card" ? CARD_PHOTO_SIZES : undefined}\n |
 * @mutate src/lib/declutter/photoSizes.ts |   return small ? `${small} ${CARD_PHOTO_SMALL_PX}w, ${cardUrl} ${cardPx}w` : undefined; |   return undefined;
 * @mutate src/lib/declutter/photoSizes.ts |   if (at < 0 \|\| publicUrl.includes("?")) return null; |
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { ListingThumb } from "@/components/declutter/ListingThumb";
import { cardPhotoSrcSet, squarePhotoUrl, THUMB_PHOTO_PX, CARD_PHOTO_SIZES } from "./photoSizes";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: (bucket: string) => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://ref.supabase.co/storage/v1/object/public/${bucket}/${path}` } }) }) } },
}));

afterEach(cleanup);

const ORIGINAL = "https://ref.supabase.co/storage/v1/object/public/job-photos/u1/a.jpg";

describe("Declutter photos are asked for at the size they draw", () => {
  it("(c) builds the square transform from a public object URL, and nothing from any other URL", () => {
    expect(squarePhotoUrl(ORIGINAL, 160)).toBe("https://ref.supabase.co/storage/v1/render/image/public/job-photos/u1/a.jpg?width=160&height=160&resize=cover&quality=70");
    expect(squarePhotoUrl("https://photos.test/a.jpg", 160)).toBeNull();
    expect(squarePhotoUrl(`${ORIGINAL}?x=1`, 160)).toBeNull();
    expect(cardPhotoSrcSet("https://photos.test/a.jpg", "C480", 480)).toBeUndefined();
  });

  it("(a) Selling's thumbnail asks for the 160 square and falls back to the original", () => {
    const { container } = render(<ListingThumb path="u1/a.jpg" category="furniture" />);
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toContain(`/render/image/public/job-photos/u1/a.jpg?width=${THUMB_PHOTO_PX}&height=${THUMB_PHOTO_PX}`);
    fireEvent.error(img);
    expect((container.querySelector("img") as HTMLImageElement).getAttribute("src")).toBe(ORIGINAL);
  });

  it("(b) a Browse card offers the 320 square beside the 480, sized to the card", () => {
    const set = cardPhotoSrcSet(ORIGINAL, "C480", 480) as string;
    expect(set).toBe(`${squarePhotoUrl(ORIGINAL, 320)} 320w, C480 480w`);
    expect(CARD_PHOTO_SIZES).toBe("(min-width: 640px) 250px, calc(50vw - 26px)");
    const card = blankComments(readFileSync(resolve(__dirname, "../../components/declutter/DeclutterItemCard.tsx"), "utf8"));
    expect(card).toMatch(/srcSet=\{photoStage === "card" \? cardPhotoSrcSet\(photoPublicUrl\(photoPath\), photoCardUrl\(photoPath\), CARD_PHOTO_PX\)/);
    expect(card).toMatch(/sizes=\{photoStage === "card" \? CARD_PHOTO_SIZES : undefined\}/);
  });

  it("(a) Buying's cart thumbnail asks for the 160 square first", () => {
    const views = blankComments(readFileSync(resolve(__dirname, "../../components/declutter/DeclutterTradeViews.tsx"), "utf8"));
    const thumb = views.slice(views.indexOf("function CartThumb"), views.indexOf("function CartThumb") + 900);
    expect(thumb).toContain('src={stage === "thumb" ? squarePhotoUrl(photoPublicUrl(path), THUMB_PHOTO_PX) ?? photoPublicUrl(path) : photoPublicUrl(path)}');
    expect(thumb).toContain('setStage((s) => (s === "thumb" ? "full" : "failed"))');
  });
});
