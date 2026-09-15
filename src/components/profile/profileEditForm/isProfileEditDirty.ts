import type { Profile } from "@/pages/profile/types";

/** The text fields the Edit Profile save bar is driven by. */
export interface ProfileEditValues {
  phone: string;
  location: string;
  zipCode: string;
  bio: string;
  skills: string;
}

/**
 * Dirty check — the Save bar drives only the text fields (avatar / ID /
 * portfolio persist on their own). False when nothing in this set has diverged
 * from the saved profile.
 *
 * `profile` is the BASELINE: Profile.tsx's handleSave must move it to the saved
 * values on success, or the bar reappears as "Save Changes" once "Saved" clears
 * and an edit back to the pre-save value reads as "nothing changed".
 */
export function isProfileEditDirty(values: ProfileEditValues, profile: Profile | null): boolean {
  return (
    values.phone !== (profile?.phone ?? "") ||
    values.location !== (profile?.location ?? "") ||
    values.zipCode !== (profile?.zip_code ?? "") ||
    values.bio !== (profile?.bio ?? "") ||
    values.skills !== (profile?.skills ?? "")
  );
}
