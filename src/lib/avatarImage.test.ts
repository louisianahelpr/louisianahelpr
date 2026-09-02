/**
 * Regression net for the avatar guards.
 *
 * These shipped on 2026-08-31 with measured prod evidence in the module's own
 * header comment but NO test, which is the wrong way round for a guard whose
 * whole job is to be conservative in two opposite directions at once: it must
 * reject a block that carries nothing, and it must NEVER hide a real
 * photograph it merely failed to inspect. A regression in the first direction
 * looks like the owner's original defect (a coloured square with no letters);
 * a regression in the second silently replaces real members' faces with
 * monograms, which is worse and would be invisible in review.
 *
 * The two-detector structure is the specific thing being pinned. Detector (1)
 * is luma RANGE and detector (2) is the mean absolute Laplacian, and the
 * gradient case below is why both have to exist: prod row 6b472670 is a smooth
 * brown→olive wash whose stops sit ~17 luma apart, so it passes ANY sane range
 * threshold and is caught only by the Laplacian, which is identically zero for
 * a linear gradient however wide its stops. Delete either detector and one of
 * these tests fails.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  avatarInitials,
  isBlankAvatarBitmap,
  isPlaceholderAvatarUrl,
  BLANK_AVATAR_LUMA_RANGE,
  BLANK_AVATAR_DETAIL,
} from "./avatarImage";

const GRID = 16;

/**
 * Mount a fake decoded image whose pixels come from `pixel(x, y)`.
 *
 * jsdom has no canvas implementation (`getContext("2d")` returns null and the
 * `canvas` package is deliberately not a dependency), so the detector would
 * take its "cannot judge → show it" path on every input and every assertion
 * below would pass vacuously. Stubbing the 2D context is what makes the
 * arithmetic actually run.
 *
 * `pixel` returns `[r, g, b, a]`. Returning alpha 0 exercises the transparency
 * skip.
 */
function fakeImage(
  pixel: (x: number, y: number) => [number, number, number, number],
  opts: { complete?: boolean; naturalWidth?: number; taint?: boolean } = {},
): HTMLImageElement {
  const data = new Uint8ClampedArray(GRID * GRID * 4);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = (y * GRID + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }

  const ctx = {
    drawImage: vi.fn(),
    getImageData: opts.taint
      ? vi.fn(() => {
          // Exactly what a real browser throws for a canvas tainted by an
          // image served without `access-control-allow-origin`.
          throw new DOMException("Tainted canvases may not be read", "SecurityError");
        })
      : vi.fn(() => ({ data })),
  };

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );

  const img = document.createElement("img");
  Object.defineProperty(img, "complete", { value: opts.complete ?? true, configurable: true });
  Object.defineProperty(img, "naturalWidth", {
    value: opts.naturalWidth ?? 240,
    configurable: true,
  });
  return img;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isPlaceholderAvatarUrl", () => {
  it.each([
    "https://api.dicebear.com/7.x/initials/svg?seed=AH",
    "https://API.DiceBear.com/7.x/initials/svg?seed=AW",
    "https://ui-avatars.com/api/?name=Lexi",
    "https://www.gravatar.com/avatar/000?d=mp",
    "https://www.gravatar.com/avatar/000?d=identicon",
    "https://www.gravatar.com/avatar/000?d=robohash",
    "https://www.gravatar.com/avatar/000?d=wavatar",
  ])("rejects the monogram generator %s", (url) => {
    expect(isPlaceholderAvatarUrl(url)).toBe(true);
  });

  it("keeps a real gravatar upload — only the explicit ?d= defaults are generators", () => {
    expect(isPlaceholderAvatarUrl("https://www.gravatar.com/avatar/abc123")).toBe(false);
  });

  it("keeps a real Supabase avatar", () => {
    expect(
      isPlaceholderAvatarUrl(
        "https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1/object/public/avatars/u/avatar.jpg",
      ),
    ).toBe(false);
  });

  it.each([null, undefined, ""])("treats %p as not-a-generator", (url) => {
    expect(isPlaceholderAvatarUrl(url)).toBe(false);
  });
});

describe("isBlankAvatarBitmap — detector (1), luma range", () => {
  it("rejects one flat colour across the whole frame", () => {
    expect(isBlankAvatarBitmap(fakeImage(() => [192, 64, 64, 255]))).toBe(true);
  });

  it("rejects solid black and solid white", () => {
    expect(isBlankAvatarBitmap(fakeImage(() => [0, 0, 0, 255]))).toBe(true);
    expect(isBlankAvatarBitmap(fakeImage(() => [255, 255, 255, 255]))).toBe(true);
  });

  it("rejects a fully transparent frame — as empty as a flat one", () => {
    expect(isBlankAvatarBitmap(fakeImage(() => [0, 0, 0, 0]))).toBe(true);
  });

  it("accepts spread that is only just over the threshold", () => {
    // A checkerboard puts the spread in `range` AND gives the Laplacian real
    // edges, so this must pass BOTH detectors to come back false.
    const hi = 128 + BLANK_AVATAR_LUMA_RANGE * 4;
    expect(
      isBlankAvatarBitmap(
        fakeImage((x, y) => ((x + y) % 2 === 0 ? [128, 128, 128, 255] : [hi, hi, hi, 255])),
      ),
    ).toBe(false);
  });
});

describe("isBlankAvatarBitmap — detector (2), mean absolute Laplacian", () => {
  it("rejects a smooth linear gradient whose stops are far apart (prod row 6b472670)", () => {
    // Range across this frame is 15 * 12 = 180 luma — an order of magnitude
    // over BLANK_AVATAR_LUMA_RANGE, so detector (1) waves it straight through.
    // It is still a flat wash with nothing on it. This is the exact case the
    // range-only fork in ProfileHeaderCard shipped, and the reason the second
    // detector exists.
    const gradient = fakeImage((x) => {
      const v = 40 + x * 12;
      return [v, v, v, 255];
    });
    expect(isBlankAvatarBitmap(gradient)).toBe(true);
  });

  it("rejects a diagonal gradient too — direction is not the point", () => {
    const gradient = fakeImage((x, y) => {
      const v = 20 + (x + y) * 6;
      return [v, v, v, 255];
    });
    expect(isBlankAvatarBitmap(gradient)).toBe(true);
  });

  it("accepts a frame with a real edge in it", () => {
    // A hard boundary down the middle: wide range AND a non-zero Laplacian.
    const edged = fakeImage((x) => (x < GRID / 2 ? [10, 10, 10, 255] : [245, 245, 245, 255]));
    expect(isBlankAvatarBitmap(edged)).toBe(false);
  });

  it("accepts noisy detail — the shape a photograph has", () => {
    let seed = 7;
    const noisy = fakeImage(() => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const v = seed % 256;
      return [v, v, v, 255];
    });
    expect(isBlankAvatarBitmap(noisy)).toBe(false);
  });

  it("pins the thresholds so a silent widening is a test failure", () => {
    expect(BLANK_AVATAR_LUMA_RANGE).toBe(6);
    expect(BLANK_AVATAR_DETAIL).toBe(3);
  });
});

describe("isBlankAvatarBitmap — 'cannot judge' must never read as 'blank'", () => {
  it("shows an image that has not decoded yet", () => {
    expect(isBlankAvatarBitmap(fakeImage(() => [0, 0, 0, 255], { complete: false }))).toBe(false);
  });

  it("shows an image with no intrinsic width", () => {
    expect(isBlankAvatarBitmap(fakeImage(() => [0, 0, 0, 255], { naturalWidth: 0 }))).toBe(false);
  });

  it("shows an image on a tainted canvas — a host with no CORS header", () => {
    // The single most damaging possible regression: a real photograph on a
    // non-CORS host must never be replaced by a monogram because the check
    // could not run.
    expect(isBlankAvatarBitmap(fakeImage(() => [0, 0, 0, 255], { taint: true }))).toBe(false);
  });

  it("shows an image when there is no 2D context at all", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const img = document.createElement("img");
    Object.defineProperty(img, "complete", { value: true });
    Object.defineProperty(img, "naturalWidth", { value: 240 });
    expect(isBlankAvatarBitmap(img)).toBe(false);
  });

  it("shows an image with too few opaque interior samples to judge", () => {
    // Opaque only along one row: some pixels exist (so it is not the
    // all-transparent case) but almost no interior cell has a full
    // neighbourhood, which must resolve to "cannot tell", not "blank".
    const sparse = fakeImage((x, y) => (y === 8 ? [10 + x * 15, 10, 10, 255] : [0, 0, 0, 0]));
    expect(isBlankAvatarBitmap(sparse)).toBe(false);
  });
});

describe("avatarInitials", () => {
  it("takes the first and last word", () => {
    expect(avatarInitials("Lexi Lombas")).toBe("LL");
    expect(avatarInitials("Mary Anne Van Der Berg")).toBe("MB");
  });

  it("takes one letter from a single-word name", () => {
    expect(avatarInitials("Prince")).toBe("P");
  });

  it.each([null, undefined, "", "   ", "\t\n"])(
    "never returns an empty string for %p — an empty monogram IS the defect",
    (name) => {
      expect(avatarInitials(name)).toBe("?");
    },
  );

  it("honours a custom fallback", () => {
    expect(avatarInitials("   ", "??")).toBe("??");
  });

  it("keeps non-letter ink rather than falling through", () => {
    expect(avatarInitials("🙂")).toBe("🙂");
  });
});
