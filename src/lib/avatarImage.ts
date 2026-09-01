/**
 * avatarImage — "is this avatar_url actually a picture of a person?"
 *
 * THE DEFECT THIS EXISTS FOR (owner, 2026-08-31: a profile avatar rendering
 * as a solid red square with no letters on it).
 *
 * Every avatar surface in the app guarded its photo with an `onError`
 * fallback and nothing else. `onError` is necessary but nowhere near
 * sufficient: an HTTP 200 that decodes never fires `error`, so for exactly
 * the avatars that needed a fallback the fallback was UNREACHABLE. Measured
 * against prod on 2026-08-31 by loading each of the 20 non-null
 * `profiles.avatar_url` values in Chromium and sampling the decoded bitmap:
 *
 *   • 6b841926 (Dana Guidry) avatars/…2201/avatar.png — 200, 240×240, ONE
 *     distinct colour over the whole frame, luma range 0. A blank olive block.
 *   • 0faacc0c avatars/…d99dd/avatar.png — 200, 240×240, luma range 0. Same.
 *   • 41d8bf74 avatars/b0f6ebec…/avatar.png — 200, 200×200, luma range 3.
 *   • 0d5db872 avatars/9e364ba6…/avatar.png — 200, 400×400, luma range 0.
 *   • dec550ab avatars/b2df11f0…/avatar.jpg — 200, 200×200, solid #000000.
 *   • 22e7a592 avatars/f53663b1…/avatar.png — 200, 16×16, solid #c04040.
 *   • api.dicebear.com/7.x/initials/svg?seed=AH — 200, 88% of the frame is a
 *     single #e53935, a red that exists in no Helpr token; ?seed=AW is the
 *     same object in #00acc1.
 *   • www.gravatar.com/avatar/000…0?d=mp — 200, Gravatar's grey
 *     mystery-person silhouette, i.e. a placeholder by definition.
 *   • 2ec0120c user-documents/…/avatar.png — 400 NoSuchBucket. This one DOES
 *     fire `onError`, and was the only case the old guard ever caught.
 *   • The four genuine photographs measure luma range 157–217.
 *
 * Two guards, in this order, because they cost different things:
 *
 *   (a) `isPlaceholderAvatarUrl` — free, synchronous, no network. A monogram
 *       GENERATOR is not a photograph; it is a worse copy of the monogram the
 *       app already draws, off-palette, and its glyphs live inside an
 *       <img>-sandboxed SVG with no intrinsic dimensions, so the background
 *       rect always paints while the <text> is the fragile half. That is
 *       precisely how a red square arrives with no letters on it.
 *
 *   (b) `isBlankAvatarBitmap` — samples the decoded pixels. Catches the six
 *       flat-colour uploads above, which no URL pattern could ever predict.
 *
 * Kept in `src/lib` rather than beside any one component because three
 * surfaces need it (`UserAvatar`, `SavedHelperCard`, and `ProfileHeaderCard`,
 * which carries a local copy from the lane that first diagnosed this and
 * should be pointed here next time that file is open).
 */

/**
 * Is this `avatar_url` a monogram GENERATOR rather than a photograph?
 *
 * Gravatar is a deliberate special case: a real Gravatar upload IS a real
 * photo, so only the explicit blank / identicon / mystery-person DEFAULTS are
 * matched — `?d=…`. A bare gravatar URL passes through as a photo.
 */
export function isPlaceholderAvatarUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  if (u.includes("api.dicebear.com")) return true;
  if (u.includes("ui-avatars.com")) return true;
  if (u.includes("gravatar.com") && /[?&]d=(blank|identicon|mp|mystery|monsterid|retro|robohash|wavatar)/.test(u)) {
    return true;
  }
  return false;
}

/**
 * Luma spread, out of 255, below which a decoded avatar is judged to carry no
 * information at all. 6/255 ≈ 2.4%: comfortably under the 157–217 the real
 * photographs on prod measure, and comfortably over the JPEG ringing that a
 * genuinely flat upload shows (the worst flat block measured 3).
 */
export const BLANK_AVATAR_LUMA_RANGE = 6;

/**
 * Mean absolute Laplacian, in luma units, below which the frame is judged to
 * hold no DETAIL — no edge, no glyph, no face, just a smooth wash.
 *
 * Luma range alone is not enough, and prod proves it. `2cfd5d6a` (Camille
 * Testeur) is a 200×200 PNG that is a single linear gradient from brown to
 * olive — a generated block with nothing on it, indistinguishable to a viewer
 * from the solid squares above — yet its two stops happen to sit 17 luma
 * apart, so a range test set anywhere sane waves it through. Rendered in the
 * saved-helprs list it is precisely the owner's defect: a flat coloured circle
 * with no letters.
 *
 * The Laplacian is orthogonal to range: it is identically zero for ANY linear
 * gradient no matter how far apart the stops, and non-zero the moment there is
 * a boundary in the image. Measured over all 20 prod avatars at the 16×16
 * sample grid, 2026-08-31:
 *
 *   empty blocks   0, 0, 0, 0, 0, 0.58 (41d8bf74), 0.73 (2cfd5d6a gradient)
 *   ── a 17× gap, nothing lands in it ──
 *   real content   12.3 (gravatar's grey silhouette), 22.7, 43.8, 60.6,
 *                  61.7, 69.6, 101.8 (the four genuine photographs and the
 *                  two DiceBear frames, whose Arial glyphs are real edges)
 *
 * 3 sits four times above the worst empty and four times below the least
 * detailed thing that has any content in it. A photograph of a blank wall
 * would also fail this, which is the correct outcome: it carries no identity
 * either, and what replaces it is a legible monogram.
 */
export const BLANK_AVATAR_DETAIL = 3;

/** Grid the bitmap is downsampled to before sampling. 256 pixels is plenty to
 *  separate "one colour" from "a face", and the whole check costs 0.013 ms on
 *  a 240×240 source and 0.027 ms on a 4032×3024 one (measured in Chromium,
 *  2026-08-31), so it does not need gating by avatar size on list screens. */
const SAMPLE_GRID = 16;

/** Interior samples the Laplacian needs before its verdict is trusted. The
 *  16×16 grid has 196 interior cells; a mostly-transparent source can leave
 *  too few with a full neighbourhood to say anything, and "cannot tell" must
 *  never read as "blank". */
const MIN_DETAIL_SAMPLES = 24;

/**
 * Does this decoded image carry no information — a flat colour, a smooth
 * gradient, or an empty frame?
 *
 * Returns FALSE whenever it cannot tell — an image we are unable to inspect
 * is given the benefit of the doubt and shown. The two ways that happens:
 *
 *   • the bitmap isn't decoded yet (`complete` / `naturalWidth`), or
 *   • the canvas is tainted, which is what a host that sends no
 *     `access-control-allow-origin` does to `getImageData`. Callers pair this
 *     with `crossOrigin="anonymous"` to avoid the taint, and MUST keep a
 *     retry-without-CORS path (see `UserAvatar`) so that a real photo on a
 *     non-CORS host is never hidden by a check that could not run.
 */
export function isBlankAvatarBitmap(img: HTMLImageElement): boolean {
  if (!img.complete || img.naturalWidth === 0) return false;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_GRID;
    canvas.height = SAMPLE_GRID;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, SAMPLE_GRID, SAMPLE_GRID);
    const { data } = ctx.getImageData(0, 0, SAMPLE_GRID, SAMPLE_GRID);

    // Luma per cell, `null` where the source is transparent. Fully transparent
    // pixels carry no colour, so a PNG with an alpha border is not judged on
    // its padding.
    const luma: (number | null)[] = new Array(SAMPLE_GRID * SAMPLE_GRID);
    let min = 255;
    let max = 0;
    let opaque = 0;
    for (let p = 0; p < luma.length; p++) {
      const i = p * 4;
      if (data[i + 3] < 8) {
        luma[p] = null;
        continue;
      }
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      luma[p] = l;
      opaque++;
      if (l < min) min = l;
      if (l > max) max = l;
    }

    // A fully transparent PNG is as empty as a flat one.
    if (opaque === 0) return true;

    // (1) Flat colour — one tone across the whole frame.
    if (max - min < BLANK_AVATAR_LUMA_RANGE) return true;

    // (2) No detail — a smooth wash with no edge anywhere in it. The
    // Laplacian is zero for any linear gradient however wide its stops, which
    // is the case (1) provably cannot see.
    let sum = 0;
    let count = 0;
    for (let y = 1; y < SAMPLE_GRID - 1; y++) {
      for (let x = 1; x < SAMPLE_GRID - 1; x++) {
        const c = luma[y * SAMPLE_GRID + x];
        const up = luma[(y - 1) * SAMPLE_GRID + x];
        const down = luma[(y + 1) * SAMPLE_GRID + x];
        const left = luma[y * SAMPLE_GRID + x - 1];
        const right = luma[y * SAMPLE_GRID + x + 1];
        if (c === null || up === null || down === null || left === null || right === null) continue;
        sum += Math.abs(4 * c - up - down - left - right);
        count++;
      }
    }
    if (count < MIN_DETAIL_SAMPLES) return false;
    return sum / count < BLANK_AVATAR_DETAIL;
  } catch {
    // Tainted canvas (no CORS header) — cannot judge, so keep the photo.
    return false;
  }
}

/**
 * Initials for a display name, guaranteed non-empty.
 *
 * The naive form of this — `(name || "?").split(" ").map(w => w[0]).join("")`
 * — is how an empty tinted block gets manufactured out of a whitespace-only
 * name: `" ".split(" ")` is `["", ""]`, `.map(w => w[0])` is
 * `[undefined, undefined]`, `.join("")` is `""`, and the fallback renders a
 * coloured circle with nothing in it. Splitting on `/\s+/` and filtering is
 * what makes the empty case reachable at all; `fallback` is what makes it
 * non-empty.
 */
export function avatarInitials(name: string | null | undefined, fallback = "?"): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  const letters =
    parts.length === 1
      ? parts[0].charAt(0)
      : parts[0].charAt(0) + parts[parts.length - 1].charAt(0);
  // A name of "…" or "🙂" yields characters that are not letters but ARE ink,
  // so they are kept; only a genuinely empty result falls through.
  return letters.toUpperCase().trim() || fallback;
}
