/**
 * Optional progress callback. Reports a 0..1 value at major stages of
 * the canvas re-encode pipeline so callers can render a per-image
 * progress bar inside the photo thumbnail.
 */
export type CompressionProgress = (progress: number) => void;

/**
 * Compresses an image file to a target max dimension and quality, and strips
 * EXIF metadata (GPS coordinates, device info, timestamps) by re-encoding
 * through a canvas. Every image goes through this path — skipping small files
 * would preserve EXIF on uncompressed originals.
 *
 * HEIC files are returned as-is: most browsers cannot canvas-decode HEIC.
 *
 * `onProgress` (optional) is invoked at the synchronous milestones in the
 * pipeline (load, draw, encoded). It's the best-effort signal we can give
 * without a real chunked encoder — but visually it's enough to show a
 * progress bar in the thumbnail that doesn't sit at 0% the whole time.
 */
export async function compressImage(
  file: File,
  maxDimension = 1920,
  quality = 0.8,
  onProgress?: CompressionProgress,
): Promise<File> {
  // Skip non-image files and HEIC (canvas cannot decode HEIC in most browsers).
  if (!file.type.startsWith("image/") || file.type === "image/heic") {
    onProgress?.(1);
    return file;
  }

  onProgress?.(0);

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    // Guard against a permanently stalled img.onload (corrupted file or OOM).
    const loadTimeout = setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load timed out"));
    }, 10_000);

    img.onload = () => {
      clearTimeout(loadTimeout);
      URL.revokeObjectURL(url);
      onProgress?.(0.35);

      let { width, height } = img;

      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        onProgress?.(1);
        resolve(file);
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      onProgress?.(0.7);

      // Guard against a hung toBlob callback (can stall indefinitely under
      // memory pressure on some mobile browsers).
      const blobTimeout = setTimeout(() => reject(new Error("canvas.toBlob timed out")), 10_000);

      canvas.toBlob(
        (blob) => {
          clearTimeout(blobTimeout);
          if (!blob) {
            onProgress?.(1);
            resolve(file);
            return;
          }
          // Always use the canvas-encoded blob — re-encoding strips EXIF
          // (GPS, device model, timestamps) regardless of file size.
          onProgress?.(1);
          resolve(
            new File([blob], file.name, {
              type: "image/jpeg",
              lastModified: Date.now(),
            }),
          );
        },
        "image/jpeg",
        quality,
      );
    };

    img.onerror = () => {
      clearTimeout(loadTimeout);
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for compression"));
    };

    img.src = url;
  });
}
