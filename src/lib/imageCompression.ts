/**
 * Compresses an image file to a target max dimension and quality, and strips
 * EXIF metadata (GPS coordinates, device info, timestamps) by re-encoding
 * through a canvas. Every image goes through this path — skipping small files
 * would preserve EXIF on uncompressed originals.
 *
 * HEIC files are returned as-is: most browsers cannot canvas-decode HEIC.
 */
export async function compressImage(
  file: File,
  maxDimension = 1920,
  quality = 0.8
): Promise<File> {
  // Skip non-image files and HEIC (canvas cannot decode HEIC in most browsers).
  if (!file.type.startsWith("image/") || file.type === "image/heic") {
    return file;
  }

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
        resolve(file);
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // Guard against a hung toBlob callback (can stall indefinitely under
      // memory pressure on some mobile browsers).
      const blobTimeout = setTimeout(() => reject(new Error("canvas.toBlob timed out")), 10_000);

      canvas.toBlob(
        (blob) => {
          clearTimeout(blobTimeout);
          if (!blob) {
            resolve(file);
            return;
          }
          // Always use the canvas-encoded blob — re-encoding strips EXIF
          // (GPS, device model, timestamps) regardless of file size.
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
