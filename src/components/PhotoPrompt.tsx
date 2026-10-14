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
import { mutationErrorMessage, unwrapMutation } from "@/lib/mutationResult";
import { saveMyPhone } from "@/lib/phoneSave";
import { queryClient } from "@/lib/queryClient";
import { queryKeys } from "@/lib/queryKeys";
import { safeStorage } from "@/lib/safeStorage";
import { report } from "@/lib/errorLogger";
import { formatPhone } from "@/pages/auth/signup/signupHelpers";
import { ageInYears, isUnder18, under18ConfirmCopy, UNDER_18_SAVED_COPY, yearsAgoKey } from "@/lib/ageGate";
import { toast } from "sonner";

/**
 * FINISH YOUR PROFILE BEFORE THE FIRST APPLY OR POST (owner, 2026-10-09).
 *
 * Sign-up used to REQUIRE a photo, a phone and a birthday, and step 2 was where
 * real people stopped. Sign-up now asks only name, city and ZIP; this asks for
 * whatever is still missing (photo, phone, birthday) at the moment it matters,
 * once per account on this device. "Not Now", closing the prompt, and a
 * profile that is not loaded all let the action through: this prompt must
 * never be the reason an Apply or a Post did not happen, with ONE exception.
 *
 * A birthday under 18 (Q1586(c), owner 2026-10-13): it is SAVED, never
 * refused, and the action does NOT go ahead, whether they tap Save & Continue,
 * Not Now or close the prompt. The first such tap only says what it means
 * ("That makes you N ..."), since a saved one only support can change; the
 * next one saves it. Refusing it left the birthday empty, so the
 * honest minor tapped Not Now and applied anyway (lh-authz-rls review of
 * 0f7786627, must-fix 1). Saved, the profiles lock holds it, useAgeGate greys
 * every Apply/Post out at once (the cached profile is updated here) and the
 * server refuses the rest. A saved under-18 birthday also stops `askThen`.
 *
 * A phone saved here goes through save_my_phone (src/lib/phoneSave.ts), which
 * runs trg_guard_profile_phone (a number another account has is refused) and
 * the ban-evasion triggers, and rate-limits the refusal (Q1586(a)).
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
  // The under-18 birthday typed now was shown back once ("That makes you N ...").
  // A saved one only support can change, so it is never saved on the first tap
  // (lh-authz-rls re-review of 44ca75e95, should-fix 4: an adult who mis-spins
  // the wheel must get the chance to fix it). Changing the date resets it.
  const [under18Confirmed, setUnder18Confirmed] = useState(false);
  // A ref, not state: the upload's completion and a "Not Now" tap during the
  // upload must not both run the same action (a second apply_to_job).
  const pendingRef = useRef<(() => void) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { requestCrop, dialog: cropDialog } = useAvatarCrop();

  const askThen = useCallback(
    async (go: () => void) => {
      if (!userId) return go();
      // Decided from the signed-in profile the app already holds (the route
      // guard loads it before any Apply or Post): no network wait on the tap.
      // Not loaded yet: fail open, the action goes ahead without the prompt.
      const cached = queryClient.getQueryData(queryKeys.currentUser.byId(userId)) as CachedUser;
      // A saved birthday under 18: never the action (the server refuses it too).
      if (isUnder18(cached?.profile?.date_of_birth)) {
        toast.error(UNDER_18_SAVED_COPY, { id: "age-gate-saved" });
        return;
      }
      if (safeStorage.getItem(photoPromptDoneKey(userId))) return go();
      if (typeof navigator !== "undefined" && navigator.onLine === false) return go();
      if (!cached?.profile) return go();
      const m: Missing = { photo: blank(cached.profile.avatar_url), phone: blank(cached.profile.phone), dob: blank(cached.profile.date_of_birth) };
      if (!m.photo && !m.phone && !m.dob) {
        safeStorage.setItem(photoPromptDoneKey(userId), "1");
        return go();
      }
      setMissing(m);
      setPhotoAdded(false);
      setFieldError(null);
      setUnder18Confirmed(false);
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
  /** A birthday under 18 has been typed into this prompt. */
  const typedUnder18 = missing.dob && Boolean(dob) && isUnder18(dob);

  /**
   * Save the typed under-18 birthday (and a typed phone) and stop: the action
   * the prompt was opened for never runs. Runs for Save & Continue, Not Now and
   * a close alike. If the save fails the prompt stays open with the error, and
   * the action still does not run.
   */
  const saveUnder18AndStop = async () => {
    if (!userId) return;
    report(new Error("Finish your profile: birthday under 18"), {
      severity: "warning",
      tags: { source: "PhotoPrompt.under18", user_id: userId },
    });
    setSaving(true);
    setFieldError(null);
    try {
      const digits = phone.replace(/\D/g, "");
      if (missing.phone && digits.length >= 10) {
        // A refused phone does not hold the birthday back: the birthday is what matters here.
        const phoneResult = await saveMyPhone(userId, phone.trim());
        if (!phoneResult.ok) report(new Error(`PhotoPrompt.under18 phone not saved: ${phoneResult.message}`), { severity: "info", tags: { source: "PhotoPrompt.under18" } });
      }
      unwrapMutation(
        await supabase.from("profiles").update({ date_of_birth: dob }).eq("user_id", userId).select("id"),
        { action: "save your birthday", context: { userId } },
      );
    } catch (err) {
      report(err, { severity: "warning", tags: { source: "PhotoPrompt.saveUnder18" } });
      setFieldError(mutationErrorMessage(err, "Couldn't save your birthday just now. Try again."));
      setSaving(false);
      return;
    }
    setSaving(false);
    // The grey-out reads this cache (useAgeGate): it starts now, not after a refetch.
    queryClient.setQueryData(queryKeys.currentUser.byId(userId), (current: CachedUser) =>
      current?.profile ? { ...current, profile: { ...current.profile, date_of_birth: dob } } : current,
    );
    void queryClient.invalidateQueries({ queryKey: queryKeys.currentUser.byId(userId) });
    pendingRef.current = null;
    setOpen(false);
    safeStorage.setItem(photoPromptDoneKey(userId), "1");
    toast.error(UNDER_18_SAVED_COPY, { id: "age-gate-saved" });
  };

  /**
   * The first tap with an under-18 birthday typed says what it means and stops
   * (nothing saved, no action); the next tap saves it and stops.
   */
  const under18Tap = () => {
    if (!under18Confirmed) {
      setUnder18Confirmed(true);
      setFieldError(under18ConfirmCopy(ageInYears(dob)));
      return;
    }
    void saveUnder18AndStop();
  };

  /** Not Now / close: the action goes ahead, unless an under-18 birthday was typed. */
  const decline = () => {
    if (busy) return;
    if (typedUnder18) return under18Tap();
    proceed();
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
    // Photo was the only thing missing: done. With details to fill, stay open.
    if (asksDetails) setPhotoAdded(true);
    else proceed();
  };

  const saveDetails = async () => {
    if (!userId) return proceed();
    const digits = phone.replace(/\D/g, "");
    if (missing.phone && phone.trim() && digits.length < 10) return setFieldError("Enter a 10-digit phone number, or leave it blank.");
    // isUnder18: the same rule as the Apply/Post grey-out and the server (Q1586(c)).
    // Saved, never refused, and the action stops (see the header). The report
    // inside keeps the disclosure visible to an admin (code review, 2026-10-09).
    if (typedUnder18) return under18Tap();
    // Undefined fields are dropped from the JSON body, so only what was typed is written.
    const savePhone = missing.phone && digits.length >= 10 ? phone.trim() : undefined;
    const saveDob = missing.dob && dob ? dob : undefined;
    if (savePhone === undefined && saveDob === undefined) return proceed();
    setSaving(true);
    setFieldError(null);
    try {
      // Q1586(a): the phone goes through save_my_phone (rate-limited; a number
      // another account has comes back as an answer, not an error).
      if (savePhone !== undefined) {
        const phoneResult = await saveMyPhone(userId, savePhone);
        if (!phoneResult.ok) {
          setFieldError(phoneResult.message);
          setSaving(false);
          return;
        }
      }
      if (saveDob !== undefined) {
        unwrapMutation(
          await supabase.from("profiles").update({ date_of_birth: saveDob }).eq("user_id", userId).select("id"),
          { action: "save your birthday", context: { userId } },
        );
      }
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

  // Up to today, not today - 18 years: a birthday under 18 must be enterable,
  // or the honest answer could never be given (Q1586(c), 2026-10-13). The
  // wheel still OPENS 18 years back (openAt), as it did when that was the cap.
  const maxDob = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
        onOpenChange={(next) => { if (!next) decline(); }}
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
        onSecondary={decline}
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
                <DatePickerField wheel id="prompt-dob" value={dob} onChange={(v) => { setDob(v); setFieldError(null); setUnder18Confirmed(false); }} min={minDob} max={maxDob} openAt={yearsAgoKey(18)} />
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
