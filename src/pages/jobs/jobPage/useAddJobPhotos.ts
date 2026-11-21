import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/imageCompression";
import { report } from "@/lib/errorLogger";
import { unwrapMutation, mutationErrorMessage } from "@/lib/mutationResult";
import { queryKeys } from "@/lib/queryKeys";
import { storageExtFor } from "@/lib/storageExt";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";

/** The photo types a job takes, and how many (the same allowlist and cap as Post a job, useJobMediaUpload). */
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const MAX_JOB_PHOTOS = 5;

/**
 * Audit 11-21 (High): the open job with no applicants offered "Add a photo", but it opened EditJobDialog, which has
 * no photo field. This adds photos to the poster's open job in place: the same clean-up (compressImage re-encodes and
 * strips EXIF), the same job-photos bucket and `<jobId>/` path, and the same 5-photo cap as Post a job. The write is
 * the poster's own jobs row; enforce_poster_jobs_money_lock leaves `photos` open until a Helpr is booked.
 */
export function useAddJobPhotos(jobId: string, existing: string[] | null | undefined) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const add = async (picked: File[]) => {
    const have = existing ?? [];
    const safe = picked.filter((f) => PHOTO_TYPES.has(f.type));
    if (safe.length < picked.length) toast.error("Photos must be JPG, PNG, WebP or GIF.");
    const room = MAX_JOB_PHOTOS - have.length;
    if (safe.length === 0 || room <= 0) return false;
    if (safe.length > room) toast.error(`A job takes up to ${MAX_JOB_PHOTOS} photos.`);
    setBusy(true);
    try {
      const urls: string[] = [];
      for (const raw of safe.slice(0, room)) {
        const file = await compressImage(raw, 1920, 0.8);
        const path = `${jobId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${storageExtFor(file, "jpg")}`;
        const { error } = await supabase.storage.from("job-photos").upload(path, file, { cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL });
        if (error) {
          report(error, { tags: { source: "useAddJobPhotos.upload" } });
          continue;
        }
        urls.push(supabase.storage.from("job-photos").getPublicUrl(path).data.publicUrl);
      }
      if (urls.length === 0) {
        toast.error("Your photo didn't upload. Check your connection and try again.");
        return false;
      }
      unwrapMutation(
        await supabase.from("jobs").update({ photos: [...have, ...urls] }).eq("id", jobId).select("id"),
        { action: "add these photos to your job" },
      );
      await qc.invalidateQueries({ queryKey: queryKeys.jobs.all });
      toast.success(urls.length === 1 ? "Photo added." : `${urls.length} photos added.`);
      return true;
    } catch (err) {
      report(err as Error, { tags: { source: "useAddJobPhotos.attach" } });
      toast.error(mutationErrorMessage(err, "Your photo didn't save. Try again."));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { add, busy };
}
