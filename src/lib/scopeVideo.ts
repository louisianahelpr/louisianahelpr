/**
 * Scope video (the optional clip on a job post): what the client accepts
 * before the job is posted.
 *
 * The video uploads AFTER the job row exists, and a failed upload is
 * non-fatal (the job posts without it), so a file the bucket would refuse
 * must be refused here, at selection, where the person can still pick
 * another. Size and type restate the `job-photos` bucket's own
 * `file_size_limit` / `allowed_mime_types`
 * (20260915055517_storage_bucket_limits.sql; src/test/uploadCapsWithinBucketLimit.test.ts
 * keeps the size at or under the bucket's). The 30-second limit is the one
 * the picker's own label promises.
 */

export const SCOPE_VIDEO_BUCKET = "job-photos";

/** The bucket's file_size_limit (50 MB). */
export const SCOPE_VIDEO_MAX_BYTES = 50 * 1024 * 1024;

/** The bucket's video MIME types. */
const SCOPE_VIDEO_TYPES: readonly string[] = ["video/mp4", "video/quicktime", "video/webm"];

/** The picker label says "30s Max"; half a second of slack for container rounding. */
export const SCOPE_VIDEO_MAX_SECONDS = 30;
const DURATION_SLACK_SECONDS = 0.5;

/** Why a picked file cannot be the scope video, or null when size and type are fine. */
export function scopeVideoFileProblem(file: { type: string; size: number }): string | null {
  if (!SCOPE_VIDEO_TYPES.includes(file.type)) {
    return "That video format isn't supported. Use an MP4, MOV or WebM clip.";
  }
  if (file.size > SCOPE_VIDEO_MAX_BYTES) {
    return "That video is too large (max 50 MB). Try a shorter clip.";
  }
  return null;
}

/** Why a clip of this length cannot be the scope video, or null. An unknown length is allowed (the bucket's size cap still bounds it). */
export function scopeVideoDurationProblem(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  if (seconds > SCOPE_VIDEO_MAX_SECONDS + DURATION_SLACK_SECONDS) {
    return `That video is ${Math.round(seconds)}s long. Pick a clip of ${SCOPE_VIDEO_MAX_SECONDS} seconds or less.`;
  }
  return null;
}

/**
 * The clip's length in seconds, read from its metadata, or null when the
 * browser cannot read it within `timeoutMs` (an unreadable container is not
 * a reason to refuse the clip).
 */
export function readVideoDuration(file: Blob, timeoutMs = 5000): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    video.preload = "metadata";
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => finish(null);
    video.src = url;
  });
}
