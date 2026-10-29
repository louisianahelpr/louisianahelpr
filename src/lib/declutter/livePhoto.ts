/**
 * Anti-lying #2, "Live camera only" (owner 2026-10-28): a handover photo is taken with the camera at that moment.
 *
 * Every handover photo input opens the camera (capture="environment"), and the server refuses a photo uploaded more
 * than 10 minutes before the step (photo_too_old, 20261029002010: storage.objects.created_at, the storage server's
 * clock). This is the same rule on the device, first: a file whose own time (File.lastModified, the moment the
 * camera wrote it) is more than 10 minutes old is refused before it is uploaded, in the same plain words.
 * A file with no time (lastModified 0) is left to the server's check.
 */
export const LIVE_PHOTO_MAX_AGE_MS = 10 * 60_000;

export function assertLivePhoto(file: File, now: number = Date.now()): void {
  if (file.lastModified > 0 && now - file.lastModified > LIVE_PHOTO_MAX_AGE_MS) throw new Error("photo_too_old");
}
