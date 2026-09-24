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

// The plugin rejects a back-out with the same promise as a real failure
// (CameraPlugin.swift: "User cancelled photos app"; "User denied access to
// photos|camera" on a refused permission). NB-007: those are three outcomes.
const CANCELLED = /User cancelled/i;
const DENIED = /User denied/i;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err ?? ""));

/**
 * What to tell the user after a picker/camera call threw. null = nothing (they
 * backed out). A denied permission points at Settings, since iOS asks only once
 * and "try again" would silently fail forever; `isError` is false for it.
 */
export function pickerFailure(err: unknown, kind: "photos" | "camera"): { copy: string; isError: boolean } | null {
  const m = message(err);
  if (CANCELLED.test(m)) return null; // NB-007 cancel is silent
  if (DENIED.test(m)) {
    return {
      copy: `${kind === "camera" ? "Camera" : "Photo"} access is off. Turn it on in Settings, then try again.`, // NB-007 denied
      isError: false,
    };
  }
  return {
    copy: kind === "camera" ? "Couldn't open the camera. Please try again." : "Couldn't open your photos. Please try again.",
    isError: true,
  };
}

/**
 * Pick up to `limit` images from the device library. Returns [] if the
 * user cancels. Throws on plugin/permission failure — callers should
 * report() and fall back gracefully.
 */
export async function pickImagesNative(limit: number): Promise<File[]> {
  const { Camera } = await import("@capacitor/camera");
  // Cap longest-edge at 1600px — a 12MP iPhone HEIC at quality 80 is still
  // 3-5MB raw, which saturates LTE on a multi-pick. 1600px is more than
  // enough for the job-photo + profile-photo + intro-photo surfaces; the
  // plugin preserves aspect ratio so portrait selfies stay portrait.
  let result;
  try {
    result = await Camera.pickImages({ quality: 80, limit, width: 1600, height: 1600 });
  } catch (err) {
    if (CANCELLED.test(message(err))) return [];
    throw err;
  }
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
  let photo;
  try {
    photo = await Camera.getPhoto({
      quality: 80,
      // See pickImagesNative — same 1600px longest-edge cap.
      width: 1600,
      height: 1600,
      resultType: CameraResultType.Uri,
      source: CameraSource.Camera,
    });
  } catch (err) {
    if (CANCELLED.test(message(err))) return null;
    throw err;
  }
  return photoToFile(photo.webPath, photo.format);
}
