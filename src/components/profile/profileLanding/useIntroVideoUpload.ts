import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { report } from "@/lib/errorLogger";
import type { Profile } from "./types";

// Hard size ceiling — Supabase Storage upload rejects files over its
// per-bucket limit, and an iPhone 4K HEVC 60-second clip easily exceeds
// 100 MB. Reject upfront with a clear toast instead of letting the
// request silently 5xx after a long upload. Real client-side
// compression is phase 2; this is the cheap guard rail.
const VIDEO_UPLOAD_MAX_BYTES = 30 * 1024 * 1024; // 30 MB

export function useIntroVideoUpload(profile: Profile | null) {
  const [videoUploading, setVideoUploading] = useState(false);

  const handleVideoUpload = async (file: File) => {
    if (!profile?.user_id) return;
    if (file.size > VIDEO_UPLOAD_MAX_BYTES) {
      toast.error(
        `Video is ${Math.round(file.size / 1024 / 1024)} MB. Trim under 30 MB (≈30 seconds of 1080p, or 60 seconds of 720p) and try again.`,
      );
      return;
    }
    setVideoUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "mp4";
      const path = `${profile.user_id}/intro.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("profile-videos")
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("profile-videos").getPublicUrl(path);
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ intro_video_url: urlData.publicUrl })
        .eq("user_id", profile.user_id);
      if (updateError) throw updateError;
      // Reload page so ProfileLanding reflects the new URL from the DB.
      window.location.reload();
    } catch (err) {
      toast.error("Couldn't upload that video. Please try again.");
      report(err, { tags: { source: "ProfileLanding.handleVideoUpload" } });
    } finally {
      setVideoUploading(false);
    }
  };

  return { videoUploading, handleVideoUpload };
}
