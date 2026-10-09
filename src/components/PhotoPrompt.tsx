import { useCallback, useRef, useState } from "react";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { useAvatarCrop } from "@/components/profile/AvatarCropDialog";
import { DatePickerField } from "@/components/DatePickerField";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthReady } from "@/hooks/useAuthReady";
import { supabase } from "@/integrations/supabase/client";
import { assertUploadableAvatar, replaceAvatarObject } from "@/lib/avatarStorage";
import { readProfileAvatarUrl } from "@/lib/readProfileAvatarUrl";
import { mutationErrorMessage, phoneInUseMessage, unwrapMutation } from "@/lib/mutationResult";
import { queryClient } from "@/lib/queryClient";
import { queryKeys } from "@/lib/queryKeys";
import { safeStorage } from "@/lib/safeStorage";
import { report } from "@/lib/errorLogger";
import { ageFromDob, formatPhone } from "@/pages/auth/signup/signupHelpers";
import { toast } from "sonner";

/**
 * FINISH YOUR PROFILE BEFORE THE FIRST APPLY OR POST (owner, 2026-10-09).
 *
 * Sign-up used to REQUIRE a photo, a phone and a birthday, and step 2 was where
 * real people stopped. Sign-up now asks only name, city and ZIP; this asks for
 * whatever is still missing (photo, phone, birthday) at the moment it matters,
 * once per account on this device. "Not Now", closing the prompt, and a
 * profile that is not loaded all let the action through: this prompt must
 * never be the reason an Apply or a Post did not happen.
 *
 * A phone saved here goes through trg_guard_profile_phone (a number another
 * account has is refused) and the existing ban-evasion flag trigger
 * (20261009175007).
 *
 * `askThen(go)` runs `go` straight away when nothing is missing, the member
 * was asked before, is offline, is signed out, or their profile is not loaded
 * yet; otherwise it opens the prompt and runs `go` once, after they save or
 * decline. Render `dialog` once.
 */
export const photoPromptDoneKey = (userId: string) => `lh:photo-prompt-done:${userId}`;

type CachedProfile = { avatar_url?: string | null; phone?: string | null; date_of_birth?: string | null };
type CachedUser = { profile?: CachedProfile | null } | undefined;
type Missing = { photo: boolean; phone: boolean; dob: boolean };

const blank = (v: string | null | undefined) => !v || !v.trim();

export function usePhotoPrompt() {
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState<Missing>({ photo: false, phone: false, dob: false });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoAdded, setPhotoAdded] = useState(false);
  const [phone, setPhone] = useState("");
  const [dob, setDob] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  // A ref, not state: the upload's completion and a "Not Now" tap during the
  // upload must not both run the same action (a second apply_to_job).
  const pendingRef = useRef<(() => void) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { requestCrop, dialog: cropDialog } = useAvatarCrop();

  const askThen = useCallback(
    async (go: () => void) => {
      if (!userId || safeStorage.getItem(photoPromptDoneKey(userId))) return go();
      if (typeof navigator !== "undefined" && navigator.onLine === false) return go();
      // Decided from the signed-in profile the app already holds (the route
      // guard loads it before any Apply or Post): no network wait on the tap.
      // Not loaded yet: fail open, the action goes ahead without the prompt.
      const cached = queryClient.getQueryData(queryKeys.currentUser.byId(userId)) as CachedUser;
      if (!cached?.profile) return go();
      const m: Missing = { photo: blank(cached.profile.avatar_url), phone: blank(cached.profile.phone), dob: blank(cached.profile.date_of_birth) };
      if (!m.photo && !m.phone && !m.dob) {
        safeStorage.setItem(photoPromptDoneKey(userId), "1");
        return go();
      }
      setMissing(m);
      setPhotoAdded(false);
      setFieldError(null);
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

  const asksDetails = missing.phone || missing.dob;
  const busy = uploading || saving;

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
    // Photo was the only thing missing: done. With details to fill, stay open.
    if (asksDetails) setPhotoAdded(true);
    else proceed();
  };

  const saveDetails = async () => {
    if (!userId) return proceed();
    const digits = phone.replace(/\D/g, "");
    if (missing.phone && phone.trim() && digits.length < 10) return setFieldError("Enter a 10-digit phone number, or leave it blank.");
    if (missing.dob && dob && ageFromDob(dob) < 18) {
      // They ticked the 18+ box at sign-up; a birthday under 18 is a disclosure
      // an admin should see, not just a field error (code review, 2026-10-09).
      report(new Error("Finish your profile: birthday under 18"), {
        severity: "warning",
        tags: { source: "PhotoPrompt.under18", user_id: userId },
      });
      return setFieldError("You'll need to be 18 or older to use Helpr.");
    }
    // Undefined fields are dropped from the JSON body, so only what was typed is written.
    const savePhone = missing.phone && digits.length >= 10 ? phone.trim() : undefined;
    const saveDob = missing.dob && dob ? dob : undefined;
    if (savePhone === undefined && saveDob === undefined) return proceed();
    setSaving(true);
    setFieldError(null);
    try {
      const res = await supabase.from("profiles").update({ phone: savePhone, date_of_birth: saveDob }).eq("user_id", userId).select("id");
      // A number another account already has is refused by the database
      // (trg_guard_profile_phone, unique_violation).
      const inUse = phoneInUseMessage(res.error);
      if (inUse) {
        setFieldError(inUse);
        setSaving(false);
        return;
      }
      unwrapMutation(res, { action: "save your phone and birthday", context: { userId } });
    } catch (err) {
      report(err, { severity: "warning", tags: { source: "PhotoPrompt.saveDetails" } });
      setFieldError(mutationErrorMessage(err, "Couldn't save that just now. Try again, or tap Not Now."));
      setSaving(false);
      return;
    }
    setSaving(false);
    void queryClient.invalidateQueries({ queryKey: queryKeys.currentUser.byId(userId) });
    proceed();
  };

  const maxDob = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 18);
    return d.toISOString().split("T")[0];
  })();
  const minDob = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 120);
    return d.toISOString().split("T")[0];
  })();

  const dialog = (
    <>
      <BrandConfirmDialog
        open={open}
        // Closing it (Escape, tap outside, X) is a "Not Now", never a dropped action.
        onOpenChange={(next) => { if (!next && !busy) proceed(); }}
        title={asksDetails ? "Finish your profile" : "Add a profile photo?"}
        description={
          asksDetails
            ? "People are more likely to hire you, and to take your job, when they know who they're meeting. It takes a few seconds."
            : "People are more likely to hire you, and to take your job, when they can see who they're meeting. It takes a few seconds."
        }
        primaryLabel={asksDetails ? (saving ? "Saving…" : "Save & Continue") : uploading ? "Uploading…" : "Add Photo"}
        primaryDisabled={busy}
        onPrimary={(e) => {
          e.preventDefault();
          if (asksDetails) void saveDetails();
          else inputRef.current?.click();
        }}
        secondaryLabel="Not Now"
        onSecondary={() => { if (!busy) proceed(); }}
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
        {asksDetails && (
          <div className="space-y-3 text-left">
            {missing.photo && (
              <button
                type="button"
                className="text-ds-14 font-sans font-semibold underline underline-offset-2 disabled:opacity-60"
                onClick={() => inputRef.current?.click()}
                disabled={busy || photoAdded}
              >
                {photoAdded ? "Photo added" : uploading ? "Uploading…" : "Add a profile photo"}
              </button>
            )}
            {missing.phone && (
              <div className="space-y-1.5">
                <Label htmlFor="prompt-phone">Phone number</Label>
                <Input
                  id="prompt-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={14}
                  value={phone}
                  onChange={(e) => { setPhone(formatPhone(e.target.value)); setFieldError(null); }}
                  placeholder="(337) 555-0123"
                />
              </div>
            )}
            {missing.dob && (
              <div className="space-y-1.5">
                <Label htmlFor="prompt-dob">Birthday</Label>
                <DatePickerField wheel id="prompt-dob" value={dob} onChange={(v) => { setDob(v); setFieldError(null); }} min={minDob} max={maxDob} />
              </div>
            )}
            {fieldError && (
              <p role="alert" className="text-ds-13 text-[hsl(var(--destructive-ink))]">{fieldError}</p>
            )}
          </div>
        )}
      </BrandConfirmDialog>
      {cropDialog}
    </>
  );

  return { askThen, dialog };
}
