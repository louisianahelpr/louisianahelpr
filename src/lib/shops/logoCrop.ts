/**
 * SH12 (shop profile kit, owner 2026-10-19 ~00:35Z): a shop's logo is its
 * avatar everywhere (the hero, Shops browse cards, the printable sign), and
 * every one of those shows it in a square or a circle. A wide or tall upload
 * used to be stored as it came and cropped by each screen's object-cover,
 * so the sign (which crops itself) and the page could centre it differently.
 * The logo is now square-cropped ONCE, centred, before it is cleaned and
 * uploaded; cleanListingPhoto still re-encodes it and refuses metadata.
 *
 * A file the browser cannot draw (HEIC, no canvas) is handed on unchanged:
 * cleanListingPhoto then refuses it with the same plain words as any photo.
 */

/** The centred square inside a w x h image: the source rectangle to draw. */
export function squareCropRect(w: number, h: number): { sx: number; sy: number; size: number } {
  const size = Math.max(1, Math.min(w, h));
  return { sx: Math.floor((w - size) / 2), sy: Math.floor((h - size) / 2), size };
}

/** Largest side a stored logo keeps: every screen shows it at 160px or less (x2 for retina, x2 headroom). */
const LOGO_MAX_SIDE = 640;

export async function squareCropLogo(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/heic" || typeof document === "undefined") return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("logo_unreadable"));
      el.src = url;
    });
    const { sx, sy, size } = squareCropRect(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const out = Math.min(size, LOGO_MAX_SIDE);
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, sx, sy, size, size, 0, 0, out, out);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob || blob.size === 0) return file;
    return new File([blob], "logo.jpg", { type: "image/jpeg" });
  } catch (err) {
    // Not silent: logged, and the original goes on to cleanListingPhoto, which refuses what it cannot clean.
    console.warn("[squareCropLogo] could not crop the logo; uploading it uncropped", err instanceof Error ? err.message : String(err));
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}
