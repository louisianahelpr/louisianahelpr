/**
 * DECL-ITEM-SPEED (B67): the item page's photo was the 462 KB original (Slow 4G lab, 375 + 4x CPU: LCP 14.1 s, the
 * photo alone 6.0 s). The frame now shows a width-limited WebP with a srcSet (720 / 1080), the viewer keeps the
 * original, and a transform that fails falls back to the original before the placeholder.
 *
 * @mutate src/lib/declutter/pagePhoto.ts |   return `${publicUrl.slice(0, at)}/storage/v1/render/image/public/ |   return `${publicUrl.slice(0, at)}/storage/v1/object/public/
 * @mutate src/components/declutter/FallbackImg.tsx |       onError={() => setFailed({ src, stage: retrying \|\| !retrySrc ? "gone" : "retry" })} |       onError={() => setFailed({ src, stage: "gone" })}
 * @mutate src/components/declutter/DeclutterGallery.tsx |                 src={display?.[i]?.src ?? url} |                 src={url}
 * @mutate src/components/declutter/DeclutterItemView.tsx | <DeclutterGallery urls={urls} display={display} category | <DeclutterGallery urls={urls} category
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { pagePhoto, pagePhotoUrl } from "./pagePhoto";
import { FallbackImg } from "@/components/declutter/FallbackImg";
import { DeclutterGallery } from "@/components/declutter/DeclutterGallery";

vi.mock("@/components/dashboard/PhotoLightbox", () => ({ PhotoLightbox: () => null }));

const ORIGINAL = "https://x.supabase.co/storage/v1/object/public/job-photos/u1/declutter/i1/a.jpg";

describe("the item page's photo", () => {
  it("is the Storage transform of the same object, width only (the aspect and the frame's crop are unchanged)", () => {
    // What supabase-js getPublicUrl(path, { transform: { width: 720, quality: 75 } }) returns for this object.
    expect(pagePhotoUrl(ORIGINAL, 720)).toBe("https://x.supabase.co/storage/v1/render/image/public/job-photos/u1/declutter/i1/a.jpg?width=720&quality=75");
    expect(pagePhoto(ORIGINAL)?.srcSet).toBe(
      "https://x.supabase.co/storage/v1/render/image/public/job-photos/u1/declutter/i1/a.jpg?width=720&quality=75 720w, "
      + "https://x.supabase.co/storage/v1/render/image/public/job-photos/u1/declutter/i1/a.jpg?width=1080&quality=75 1080w",
    );
  });

  it("anything that is not a public Storage object URL is shown as it is", () => {
    expect(pagePhoto("blob:abc")).toBeNull();
    expect(pagePhoto(`${ORIGINAL}?token=1`)).toBeNull();
  });

  it("a resized photo that fails falls back to the original, then to the placeholder", () => {
    const shown = pagePhoto(ORIGINAL)!;
    render(<FallbackImg src={shown.src} srcSet={shown.srcSet} retrySrc={ORIGINAL} alt="Photo 1" fallback={<span data-testid="ph" />} />);
    const img = screen.getByAltText("Photo 1") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(shown.src);
    fireEvent.error(img);
    const again = screen.getByAltText("Photo 1") as HTMLImageElement;
    expect(again.getAttribute("src")).toBe(ORIGINAL);
    expect(again.getAttribute("srcset")).toBeNull();
    fireEvent.error(again);
    expect(screen.getByTestId("ph")).toBeTruthy();
  });

  it("the gallery frame shows the resized photo, and the item page passes it", () => {
    render(<DeclutterGallery urls={[ORIGINAL]} display={[pagePhoto(ORIGINAL)]} category="furniture" title="Chair" />);
    const img = screen.getByAltText("Photo 1 of 1") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(pagePhoto(ORIGINAL)!.src);
    expect(img.getAttribute("sizes")).toBe("(min-width: 640px) 680px, calc(100vw - 40px)");
    const view = readFileSync("src/components/declutter/DeclutterItemView.tsx", "utf8");
    expect(view).toContain("<DeclutterGallery urls={urls} display={display} category");
    expect(view.match(/pagePhoto/g)?.length ?? 0).toBeGreaterThan(1);
  });
});
