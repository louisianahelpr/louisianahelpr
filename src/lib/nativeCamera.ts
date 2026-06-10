/**
 * Native camera / photo-library capture via @capacitor/camera.
 *
 * WKWebView's `<input type="file" accept="image/*">` works on iOS but is
 * flaky: large captures sometimes never resolve the change event, HEIC
 * frames arrive without a usable MIME type, and there's no permission
 * rationale hook. On native we route through @capacitor/camera instead and
 * hand back plain `File`s so the existing `supabase.storage.upload(file)`
 * path is unchanged. Web keeps using the file input.
 *
 * Dynamic import keeps the plugin chunk off the web critical-path bundle.
 */

async function photoToFile(
  path: string | undefined,
  format: string | undefined,
): Promise<File | null> {
  if (!path) return null;
  const resp = await fetch(path);
  const blob = await resp.blob();
  const ext = (format || "jpeg").replace(/^jpg$/, "jpeg");
  const name = `photo-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  return new File([blob], name, { type: blob.type || "image/jpeg" });
}

/**
 * Pick up to `limit` images from the device library. Returns [] if the
 * user cancels. Throws on plugin/permission failure — callers should
 * report() and fall back gracefully.
 */
export async function pickImagesNative(limit: number): Promise<File[]> {
  const { Camera } = await import("@capacitor/camera");
  const result = await Camera.pickImages({ quality: 80, limit });
  const files: File[] = [];
  for (const photo of result.photos) {
    const file = await photoToFile(photo.webPath, photo.format);
    if (file) files.push(file);
  }
  return files;
}

/**
 * Capture a single photo from the camera. Returns null if cancelled.
 * Throws on plugin/permission failure.
 */
export async function takePhotoNative(): Promise<File | null> {
  const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
  const photo = await Camera.getPhoto({
    quality: 80,
    resultType: CameraResultType.Uri,
    source: CameraSource.Camera,
  });
  return photoToFile(photo.webPath, photo.format);
}
