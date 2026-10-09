import { useCallback, useRef, useState } from "react";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { useAvatarCrop } from "@/components/profile/AvatarCropDialog";
import { useAuthReady } from "@/hooks/useAuthReady";
import { supabase } from "@/integrations/supabase/client";
import { assertUploadableAvatar, replaceAvatarObject } from "@/lib/avatarStorage";
import { readProfileAvatarUrl } from "@/lib/readProfileAvatarUrl";
import { mutationErrorMessage, unwrapMutation } from "@/lib/mutationResult";
import { queryClient } from "@/lib/queryClient";
import { queryKeys } from "@/lib/queryKeys";
import { safeStorage } from "@/lib/safeStorage";
import { report } from "@/lib/errorLogger";
import { toast } from "sonner";

/**
 * ASK FOR A PROFILE PHOTO BEFORE THE FIRST APPLY OR POST (owner, 2026-10-09).
 *
 * Sign-up used to REQUIRE a photo, and that step was where real people
 * stopped. The photo is now optional at sign-up; this asks for it at the
 * moment it matters (someone is about to see you), once per account on this
 * device. "Not Now", closing the prompt, and any failure to read the profile
 * all let the action through: this prompt must never be the reason an Apply
 * or a Post did not happen.
 *
 * `askThen(go)` runs `go` straight away when the member already has a photo,
 * has been asked before, is offline (the action's own offline handling
 * speaks) or is signed out; otherwise it opens the prompt and runs `go` once,
 * after they add a photo or decline. Render `dialog` once.
 */
export const photoPromptDoneKey = (userId: string) => `lh:photo-prompt-done:${userId}`;

type CachedUser = { profile?: { avatar_url?: string | null } | null } | undefined;

export function usePhotoPrompt() {
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  // A ref, not state: the upload's completion and a "Not Now" tap during the
  // upload must not both run the same action (a second apply_to_job).
  const pendingRef = useRef<(() => void) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { requestCrop, dialog: cropDialog } = useAvatarCrop();

  const askThen = useCallback(
    async (go: () => void) => {
      if (!userId || safeStorage.getItem(photoPromptDoneKey(userId))) return go();
      if (typeof navigator !== "undefined" && navigator.onLine === false) return go();
      let url = (queryClient.getQueryData(queryKeys.currentUser.byId(userId)) as CachedUser)?.profile?.avatar_url ?? null;
      if (!url) {
        try {
          url = await readProfileAvatarUrl(userId);
        } catch (err) {
          // Fail open: the Apply or Post goes ahead without the prompt.
          report(err, { severity: "warning", tags: { source: "PhotoPrompt.readAvatar" } });
          return go();
        }
      }
      if (url) {
        safeStorage.setItem(photoPromptDoneKey(userId), "1");
        return go();
      }
      pendingRef.current = go;
      setOpen(true);
    },
    [userId],
  );

  const proceed = () => {
    const go = pendingRef.current;
    pendingRef.current = null;
    setOpen(false);
    if (userId) safeStorage.setItem(photoPromptDoneKey(userId), "1");
    go?.();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked || !userId) return;
    const file = await requestCrop(picked);
    if (!file) return;
    setUploading(true);
    let uploaded = false;
    let staleRemaining: string[];
    try {
      assertUploadableAvatar(file);
      const replaced = await replaceAvatarObject(supabase, userId, file, file.type, {
        write: async (publicUrl: string) => {
          uploaded = true;
          unwrapMutation(
            await supabase.from("profiles").update({ avatar_url: publicUrl }).eq("user_id", userId).select("id"),
            { action: "pin your new photo to your profile", context: { userId } },
          );
        },
        read: () => readProfileAvatarUrl(userId),
      });
      staleRemaining = replaced.staleRemaining;
    } catch (err) {
      toast.error(
        uploaded
          ? mutationErrorMessage(err, "Photo uploaded, but couldn't pin it to your profile. Try again?")
          : mutationErrorMessage(err, "Couldn't upload your photo. Try again, or tap Not Now."),
      );
      setUploading(false);
      return;
    }
    setUploading(false);
    void queryClient.invalidateQueries({ queryKey: queryKeys.currentUser.byId(userId) });
    // Same warning as Profile: the old photo is still being served publicly.
    if (staleRemaining.length > 0) {
      toast.error("Your new photo is saved, but we couldn't remove the previous one. It may still be visible. Change your photo again from your profile.");
    } else {
      toast.success("Photo added");
    }
    proceed();
  };

  const dialog = (
    <>
      <BrandConfirmDialog
        open={open}
        // Closing it (Escape, tap outside, X) is a "Not Now", never a dropped action.
        onOpenChange={(next) => { if (!next && !uploading) proceed(); }}
        title="Add a profile photo?"
        description="People are more likely to hire you, and to take your job, when they can see who they're meeting. It takes a few seconds."
        primaryLabel={uploading ? "Uploading…" : "Add Photo"}
        primaryDisabled={uploading}
        onPrimary={(e) => { e.preventDefault(); inputRef.current?.click(); }}
        secondaryLabel="Not Now"
        onSecondary={() => { if (!uploading) proceed(); }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a profile photo"
          onChange={onFile}
        />
      </BrandConfirmDialog>
      {cropDialog}
    </>
  );

  return { askThen, dialog };
}
