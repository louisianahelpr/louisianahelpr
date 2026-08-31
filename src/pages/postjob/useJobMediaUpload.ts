import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/imageCompression";
import { report } from "@/lib/errorLogger";
import { unwrapMutation } from "@/lib/mutationResult";

/**
 * useJobMediaUpload — owns the post-a-job photo + scope-video state and the
 * storage upload flow. Pure structural extraction from usePostJobForm: state,
 * handlers, and upload behavior are unchanged.
 *
 * The returned `uploadAndAttachPhotos` / `uploadAndAttachScopeVideo` are called
 * by the submit flow after the job row is inserted.
 */
export function useJobMediaUpload() {
  // Image upload state
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  // Scope video — optional 30s clip attached to the job.
  // Stored as a blob URL locally for preview; uploaded to storage on submit.
  const [scopeVideoFile, setScopeVideoFile] = useState<File | null>(null);
  const [scopeVideoPreviewUrl, setScopeVideoPreviewUrl] = useState<string | null>(null);

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) return;
    const url = URL.createObjectURL(file);
    setScopeVideoFile(file);
    setScopeVideoPreviewUrl(url);
  };

  const clearVideo = () => {
    setScopeVideoFile(null);
    setScopeVideoPreviewUrl(null);
  };
  // Per-image progress 0..1 keyed by current index in `imageFiles`.
  // Combined view of compression progress (selection time) and upload
  // progress (submit time) — only one phase runs at any given moment.
  const [uploadProgressByIndex, setUploadProgressByIndex] = useState<Record<number, number>>({});

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    // Strict MIME allowlist — keeps the broader `image/*` check honest
    // (a maliciously crafted SVG/AVIF could still be image/*) and gives
    // a precise toast for rejected files.
    const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    const safeFiles = files.filter((file) => allowedImageTypes.has(file.type));

    if (safeFiles.length !== files.length) {
      toast.error("Only JPG, PNG, WEBP, and GIF images are allowed.");
    }

    if (imageFiles.length + safeFiles.length > 5) {
      toast.error("Maximum 5 images allowed.");
      return;
    }
    // Compress images before storing. The compressImage pipeline re-
    // encodes through a canvas, which also strips EXIF metadata (GPS,
    // device model, timestamps) — see src/lib/imageCompression.ts.
    // We feed per-image compression progress into the same map the
    // thumbnail progress bar reads from during upload, so the user gets
    // a visible "working on it" signal during the canvas re-encode too.
    const baseIndex = imageFiles.length;
    setUploadProgressByIndex((prev) => {
      const next = { ...prev };
      safeFiles.forEach((_, i) => { next[baseIndex + i] = 0; });
      return next;
    });
    const compressed = await Promise.all(
      safeFiles.map((f, i) =>
        compressImage(f, 1920, 0.8, (p) => {
          setUploadProgressByIndex((prev) => ({ ...prev, [baseIndex + i]: p }));
        }),
      ),
    );
    // Clear the synthetic compression progress entries once compression
    // is done. They get refilled at upload time with real progress.
    setUploadProgressByIndex((prev) => {
      const next = { ...prev };
      safeFiles.forEach((_, i) => { delete next[baseIndex + i]; });
      return next;
    });
    const newFiles = [...imageFiles, ...compressed].slice(0, 5);
    setImageFiles(newFiles);
    const previews = newFiles.map((f) => URL.createObjectURL(f));
    setImagePreviews(previews);

  };

  const removeImage = (index: number) => {
    const newFiles = imageFiles.filter((_, i) => i !== index);
    setImageFiles(newFiles);
    setImagePreviews(newFiles.map((f) => URL.createObjectURL(f)));
    setUploadProgressByIndex({});
  };

  /**
   * Reorder photos locally (pre-submit only). `nextOrder` is the new
   * sequence of old indices — e.g. moving photo 2 to position 0 yields
   * `[2, 0, 1]`. Persisted into Supabase Storage in that order at submit.
   */
  const reorderImages = (nextOrder: number[]) => {
    if (nextOrder.length !== imageFiles.length) return;
    const reordered = nextOrder.map((i) => imageFiles[i]);
    setImageFiles(reordered);
    setImagePreviews(reordered.map((f) => URL.createObjectURL(f)));
    // Reset the progress map — the index→progress mapping is now stale.
    setUploadProgressByIndex({});
  };

  // Tracks upload progress so the submit button can show "Uploading 2/3"
  // instead of an opaque spinner. Set back to null after upload completes.
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);

  const uploadImages = async (jobId: string): Promise<string[]> => {
    const urls: string[] = [];
    const total = imageFiles.length;
    if (total === 0) return urls;
    setUploadProgress({ done: 0, total });
    // Seed each photo's progress to 0 so the bars render immediately at
    // the start of upload, instead of jumping from absent → 100%.
    setUploadProgressByIndex(() => {
      const next: Record<number, number> = {};
      for (let i = 0; i < total; i++) next[i] = 0;
      return next;
    });
    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const ext = file.name.split(".").pop();
      const path = `${jobId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      // Supabase storage.upload doesn't expose a fetch-level progress
      // callback, so we report a coarse 0 → 1 transition per file. It's
      // enough for the per-image bar to visibly advance and the user to
      // see which image is currently in flight.
      const { error } = await supabase.storage.from("job-photos").upload(path, file);
      if (error) {
        report(error, { tags: { source: "PostJob.uploadImage" } });
      } else {
        const { data: urlData } = supabase.storage.from("job-photos").getPublicUrl(path);
        urls.push(urlData.publicUrl);
      }
      setUploadProgress({ done: i + 1, total });
      setUploadProgressByIndex((prev) => ({ ...prev, [i]: 1 }));
    }
    setUploadProgress(null);
    return urls;
  };

  /**
   * Uploads the selected photos to storage and, if any landed, patches
   * the job row's `photos` column. No-op when there are no images.
   * Toggles the `uploading` flag around the work.
   * Also uploads the scope video if one was selected.
   */
  const uploadAndAttachPhotos = async (jobId: string) => {
    const hasPhotos = imageFiles.length > 0;
    const hasVideo = !!scopeVideoFile;
    if (!hasPhotos && !hasVideo) return;
    setUploading(true);
    const photoUrls = hasPhotos ? await uploadImages(jobId) : [];
    if (photoUrls.length > 0) {
      try {
        unwrapMutation(
          await supabase.from("jobs").update({ photos: photoUrls }).eq("id", jobId).select("id"),
          { action: "attach these photos to the job" },
        );
      } catch (photoErr) {
        report(photoErr as Error, { tags: { source: "useJobMediaUpload.attachPhotos" } });
        toast.error("Your job posted, but the photos didn't attach — you can add them from the job page.");
      }
    }
    // Upload scope video — PGRST204/42703 safe (column may not exist on prod yet)
    if (hasVideo && scopeVideoFile) {
      try {
        const ext = scopeVideoFile.name.split(".").pop() || "mp4";
        const path = `${jobId}/scope-video.${ext}`;
        const { error: vidErr } = await supabase.storage
          .from("job-photos")
          .upload(path, scopeVideoFile, { upsert: true });
        if (!vidErr) {
          const { data: urlData } = supabase.storage.from("job-photos").getPublicUrl(path);
          try {
            unwrapMutation(
              await supabase.from("jobs").update({ scope_video_url: urlData.publicUrl }).eq("id", jobId).select("id"),
              { action: "attach the scope video to the job" },
            );
          } catch (attachErr) {
            report(attachErr as Error, { tags: { source: "PostJob.attachScopeVideo" } });
          }
        } else {
          report(vidErr, { tags: { source: "PostJob.uploadScopeVideo" } });
        }
      } catch (e) {
        report(e as Error, { tags: { source: "PostJob.uploadScopeVideo" } });
      }
    }
    setUploading(false);
  };

  /**
   * Uploads the scope video (if selected) to the job-photos bucket and
   * patches the job row's scope_video_url column. No-op if no video.
   * PGRST202-safe: if the column doesn't exist yet the update silently fails.
   */
  const uploadAndAttachScopeVideo = async (jobId: string) => {
    if (!scopeVideoFile) return;
    const ext = scopeVideoFile.name.split(".").pop() ?? "mp4";
    const path = `${jobId}/scope-video.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("job-photos")
      .upload(path, scopeVideoFile, { upsert: true });
    if (upErr) return; // non-fatal — video is a nice-to-have
    const { data } = supabase.storage.from("job-photos").getPublicUrl(path);
    if (!data?.publicUrl) return;
    // Non-fatal — the column may not exist on prod yet; ignore any error,
    // but still surface a silent zero-row rejection so it's visible in logs.
    const { data: rows } = await supabase
      .from("jobs")
      .update({ scope_video_url: data.publicUrl })
      .eq("id", jobId)
      .select("id");
    if (rows && rows.length === 0) {
      report(new Error("scope video attach affected 0 rows"), { tags: { source: "PostJob.uploadAndAttachScopeVideo" }, context: { jobId } });
    }
  };

  return {
    imageFiles,
    imagePreviews,
    uploading,
    uploadProgress,
    uploadProgressByIndex,
    scopeVideoFile,
    scopeVideoPreviewUrl,
    handleVideoSelect,
    clearVideo,
    handleImageSelect,
    removeImage,
    reorderImages,
    uploadAndAttachPhotos,
    uploadAndAttachScopeVideo,
  };
}
