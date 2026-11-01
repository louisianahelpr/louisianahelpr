/**
 * CodeQL #519 (lead 2026-11-01): FallbackImg passes only our own photo URLs to <img src>.
 * @mutate src/components/declutter/FallbackImg.tsx |   const shown = safePhotoSrc(retrying ? retrySrc : src); |   const shown = retrying ? retrySrc : src;
 * @mutate src/lib/declutter/safePhotoSrc.ts |     if (url.protocol === "https:" && storageOrigin && url.origin === storageOrigin) return url.href; |     if (url.protocol === "https:") return url.href;
 * @mutate src/lib/declutter/safePhotoSrc.ts |     if (url.protocol === "blob:") return raw; |     if (url.protocol === "blob:") return undefined;
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { safePhotoSrc, safePhotoSrcSet } from "./safePhotoSrc";
import { FallbackImg } from "@/components/declutter/FallbackImg";

const HOST = new URL(String(import.meta.env.VITE_SUPABASE_URL)).origin;
const PHOTO = `${HOST}/storage/v1/object/public/job-photos/u/declutter/i/a.jpg`;

describe("safePhotoSrc", () => {
  it("keeps our storage host's https URLs, same-origin paths and blob: previews", () => {
    expect(safePhotoSrc(PHOTO)).toBe(PHOTO);
    expect(safePhotoSrc("/placeholder.png")).toBe("/placeholder.png");
    const blob = "blob:http://localhost:3000/0f0e";
    expect(safePhotoSrc(blob)).toBe(blob);
    expect(safePhotoSrc("blob:p")).toBe("blob:p");
  });
  it("drops everything else", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,<b>x</b>", "http://" + new URL(HOST).host + "/a.jpg", "https://evil.example/a.jpg", "//evil.example/a.jpg", "/\\evil.example", "", undefined]) {
      expect(safePhotoSrc(bad as string | undefined), String(bad)).toBeUndefined();
    }
  });
  it("a srcSet passes only when every candidate does", () => {
    expect(safePhotoSrcSet(`${PHOTO}?width=720 720w, ${PHOTO}?width=1080 1080w`)).toBe(`${PHOTO}?width=720 720w, ${PHOTO}?width=1080 1080w`);
    expect(safePhotoSrcSet(`${PHOTO} 720w, https://evil.example/a.jpg 1080w`)).toBeUndefined();
  });
  it("FallbackImg shows the placeholder, never an <img>, for a foreign URL", () => {
    const { rerender } = render(<FallbackImg src="https://evil.example/a.jpg" alt="x" fallback={<span data-testid="ph" />} />);
    expect(screen.getByTestId("ph")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
    rerender(<FallbackImg src={PHOTO} alt="x" fallback={<span data-testid="ph" />} />);
    expect(document.querySelector("img")?.getAttribute("src")).toBe(PHOTO);
  });
});
