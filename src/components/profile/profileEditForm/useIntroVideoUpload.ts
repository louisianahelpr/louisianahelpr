import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { report } from "@/lib/errorLogger";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import type { Profile } from "./types";

/**
 * Intro video (profiles.intro_video_url / _thumbnail_url /
 * _duration_seconds) — a short self-introduction a helpr records once and
 * every poster can play from the applicants list
 * (`activity/postedJobs/VideoPreviewModal.tsx`).
 *
 * Storage convention is NOT invented here: the `profile-videos` bucket is
 * defined by `supabase/migrations/20260702060000_create_profile_videos_bucket.sql`
 * — public bucket, 30 MB `file_size_limit`, `allowed_mime_types` of
 * mp4/quicktime/webm, owner-scoped INSERT/UPDATE/DELETE keyed on
 * `(storage.foldername(name))[1] = auth.uid()`. Every constant below mirrors
 * that migration, and the path is always `<user_id>/…` so the RLS check
 * passes. Same shape as `usePortfolio` (which uses the public `avatars`
 * bucket) — upload, then persist the public URL on `profiles`.
 */

/** Mirrors the bucket's `file_size_limit`. */
export const INTRO_VIDEO_MAX_BYTES = 30 * 1024 * 1024;

/** Mirrors the bucket's `allowed_mime_types` — a file outside this list is
 *  rejected by storage anyway, so reject it up front with human copy rather
 *  than after a 30 MB round trip. */
export const INTRO_VIDEO_MIME_WHITELIST = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const;

/** Posters skim applicants; a two-minute monologue does not get watched.
 *  Duration is advisory — if the browser can't read metadata we let it
 *  through rather than blocking on a probe that failed. */
export const INTRO_VIDEO_MAX_SECONDS = 90;

const MB = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

/** Storage path back out of a public URL, so Replace/Remove can delete the
 *  object it replaced. Returns null for any URL not in our bucket (a legacy
 *  or externally hosted URL is left untouched rather than guessed at). */
export function introVideoStoragePath(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = "/profile-videos/";
  const i = url.indexOf(marker);
  if (i === -1) return null;
  const path = url.slice(i + marker.length).split("?")[0];
  return path ? decodeURIComponent(path) : null;
}

/** Reads duration (and, best effort, a poster frame) from the picked file
 *  without uploading anything. Never throws — an unreadable file resolves
 *  to `{ duration: null, poster: null }` and the upload proceeds. */
async function probeVideo(
  file: File,
): Promise<{ duration: number | null; poster: Blob | null }> {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  // Required or iOS refuses to decode frames off-screen.
  video.playsInline = true;
  video.src = objectUrl;

  try {
    const duration = await new Promise<number | null>((resolve) => {
      const timer = window.setTimeout(() => resolve(null), 5000);
      video.onloadedmetadata = () => {
        window.clearTimeout(timer);
        resolve(Number.isFinite(video.duration) ? video.duration : null);
      };
      video.onerror = () => {
        window.clearTimeout(timer);
        resolve(null);
      };
    });

    let poster: Blob | null = null;
    if (duration !== null) {
      poster = await new Promise<Blob | null>((resolve) => {
        const timer = window.setTimeout(() => resolve(null), 5000);
        video.onseeked = () => {
          window.clearTimeout(timer);
          try {
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            if (!ctx || !canvas.width || !canvas.height) return resolve(null);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82);
          } catch {
            // Cross-origin/codec restrictions taint the canvas on some
            // WKWebView builds. A missing poster is cosmetic — the preview
            // falls back to the <video> element itself.
            resolve(null);
          }
        };
        video.onerror = () => {
          window.clearTimeout(timer);
          resolve(null);
        };
        video.currentTime = Math.min(0.5, Math.max(0, duration - 0.1));
      });
    }

    return { duration, poster };
  } finally {
    video.src = "";
    URL.revokeObjectURL(objectUrl);
  }
}

export type IntroVideoStatus = "idle" | "uploading" | "removing";

export interface IntroVideoFields {
  intro_video_url: string | null;
  intro_video_thumbnail_url: string | null;
  intro_video_duration_seconds: number | null;
}

interface UseIntroVideoUploadArgs {
  profile: Profile | null;
  /** Called with the new column values so the parent can sync its profile
   *  state without a refetch (mirrors `onPortfolioChange`). */
  onIntroVideoChange?: (fields: IntroVideoFields) => void;
}

export function useIntroVideoUpload({ profile, onIntroVideoChange }: UseIntroVideoUploadArgs) {
  const [status, setStatus] = useState<IntroVideoStatus>("idle");
  /** What the user picked, so the progress row can name it. */
  const [pendingName, setPendingName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // A ref, not the state flag: two taps in the same tick both read the stale
  // `status` before React re-renders, so the state alone cannot stop a
  // double-fire. The ref flips synchronously.
  const busyRef = useRef(false);

  const videoUrl = profile?.intro_video_url ?? null;
  const thumbnailUrl = profile?.intro_video_thumbnail_url ?? null;
  const durationSeconds = profile?.intro_video_duration_seconds ?? null;

  const validate = useCallback((file: File): string | null => {
    if (!INTRO_VIDEO_MIME_WHITELIST.includes(file.type as (typeof INTRO_VIDEO_MIME_WHITELIST)[number])) {
      return "That file isn't a video we can play. Use an MP4, MOV, or WEBM.";
    }
    if (file.size > INTRO_VIDEO_MAX_BYTES) {
      return `That video is ${MB(file.size)}. Trim it under 30 MB — about 30 seconds at 1080p, or 60 seconds at 720p.`;
    }
    return null;
  }, []);

  const pick = useCallback(() => {
    if (busyRef.current) return;
    inputRef.current?.click();
  }, []);

  const handleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Clear immediately so re-picking the SAME file still fires `change`.
      e.target.value = "";
      if (!file) return;

      const userId = profile?.user_id;
      if (!userId) {
        toast.error("We couldn't tell who you are. Reload and try again.");
        return;
      }
      if (busyRef.current) return;

      const problem = validate(file);
      if (problem) {
        hapticError();
        toast.error(problem);
        return;
      }

      busyRef.current = true;
      setPendingName(file.name);
      setStatus("uploading");

      // Everything written this run, so a failure can be unwound instead of
      // leaving a paid-for orphan sitting in the bucket forever.
      const written: string[] = [];
      const cleanUp = async () => {
        if (!written.length) return;
        const { error } = await supabase.storage.from("profile-videos").remove(written);
        if (error) report(error, { tags: { source: "useIntroVideoUpload.cleanUp" } });
      };

      try {
        const { duration, poster } = await probeVideo(file);
        if (duration !== null && duration > INTRO_VIDEO_MAX_SECONDS) {
          hapticError();
          toast.error(
            `That video is ${Math.round(duration)} seconds. Keep it under ${INTRO_VIDEO_MAX_SECONDS} — posters skim, and a short intro gets watched.`,
          );
          return;
        }

        // Timestamped filename rather than a fixed `intro.mp4` + upsert: the
        // bucket is public and CDN-cached, so overwriting one name serves the
        // OLD clip for as long as the edge cache holds it. The previous
        // object is deleted below, after the row points at the new one.
        const ext = (file.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "");
        const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const videoPath = `${userId}/intro-${stamp}.${ext || "mp4"}`;

        const { error: uploadError } = await supabase.storage
          .from("profile-videos")
          .upload(videoPath, file, { upsert: false, contentType: file.type });
        if (uploadError) throw uploadError;
        written.push(videoPath);

        let posterUrl: string | null = null;
        if (poster) {
          const posterPath = `${userId}/intro-${stamp}.jpg`;
          const { error: posterError } = await supabase.storage
            .from("profile-videos")
            .upload(posterPath, poster, { upsert: false, contentType: "image/jpeg" });
          if (posterError) {
            // Cosmetic only — never fail the whole upload over a poster frame.
            report(posterError, { tags: { source: "useIntroVideoUpload.poster" } });
          } else {
            written.push(posterPath);
            posterUrl = supabase.storage.from("profile-videos").getPublicUrl(posterPath).data.publicUrl;
          }
        }

        const publicUrl = supabase.storage.from("profile-videos").getPublicUrl(videoPath).data.publicUrl;
        const next: IntroVideoFields = {
          intro_video_url: publicUrl,
          intro_video_thumbnail_url: posterUrl,
          intro_video_duration_seconds: duration === null ? null : Math.round(duration),
        };

        const { error: updateError } = await supabase
          .from("profiles")
          .update(next)
          .eq("user_id", userId);
        // The row is the source of truth. If it didn't take, nothing was
        // uploaded as far as the product is concerned — so say so, and take
        // the orphaned object back out of storage.
        if (updateError) {
          await cleanUp();
          throw updateError;
        }

        // Only now is the old clip unreferenced.
        const previousPaths = [
          introVideoStoragePath(videoUrl),
          introVideoStoragePath(thumbnailUrl),
        ].filter((p): p is string => !!p && !written.includes(p));
        if (previousPaths.length) {
          const { error: removeError } = await supabase.storage
            .from("profile-videos")
            .remove(previousPaths);
          if (removeError) report(removeError, { tags: { source: "useIntroVideoUpload.removeOld" } });
        }

        onIntroVideoChange?.(next);
        hapticSuccess();
        toast.success("Intro video saved.");
      } catch (err) {
        hapticError();
        toast.error("Couldn't save that video. Nothing changed — please try again.");
        report(err, { tags: { source: "useIntroVideoUpload.handleFile" } });
      } finally {
        busyRef.current = false;
        setPendingName(null);
        setStatus("idle");
      }
    },
    [profile?.user_id, validate, videoUrl, thumbnailUrl, onIntroVideoChange],
  );

  const removeVideo = useCallback(async () => {
    const userId = profile?.user_id;
    if (!userId || busyRef.current) return;
    busyRef.current = true;
    setStatus("removing");
    try {
      // Row first, again: if the delete succeeds but the row keeps the URL,
      // the profile points at a 404. Clearing the row first can at worst
      // leave an unreferenced object, which the cleanup below removes.
      const cleared: IntroVideoFields = {
        intro_video_url: null,
        intro_video_thumbnail_url: null,
        intro_video_duration_seconds: null,
      };
      const { error } = await supabase.from("profiles").update(cleared).eq("user_id", userId);
      if (error) throw error;

      const paths = [introVideoStoragePath(videoUrl), introVideoStoragePath(thumbnailUrl)].filter(
        (p): p is string => !!p,
      );
      if (paths.length) {
        const { error: removeError } = await supabase.storage.from("profile-videos").remove(paths);
        if (removeError) report(removeError, { tags: { source: "useIntroVideoUpload.removeVideo" } });
      }

      onIntroVideoChange?.(cleared);
      hapticSuccess();
      toast.success("Intro video removed.");
    } catch (err) {
      hapticError();
      toast.error("Couldn't remove that video. Please try again.");
      report(err, { tags: { source: "useIntroVideoUpload.removeVideo" } });
    } finally {
      busyRef.current = false;
      setStatus("idle");
    }
  }, [profile?.user_id, videoUrl, thumbnailUrl, onIntroVideoChange]);

  return {
    videoUrl,
    thumbnailUrl,
    durationSeconds,
    status,
    pendingName,
    inputRef,
    pick,
    handleFile,
    removeVideo,
  };
}

export default useIntroVideoUpload;
