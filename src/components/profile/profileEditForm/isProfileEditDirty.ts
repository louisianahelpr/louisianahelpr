import type { Profile } from "@/pages/profile/types";
import { samePhone } from "@/lib/smsConsent";

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
    // Digits compared: the field shows "(504) 555-0199" for a stored
    // "5045550199" (displayUsPhone, app audit A3-L5), the same number.
    !samePhone(values.phone, profile?.phone) ||
    values.location !== (profile?.location ?? "") ||
    values.zipCode !== (profile?.zip_code ?? "") ||
    values.bio !== (profile?.bio ?? "") ||
    values.skills !== (profile?.skills ?? "")
  );
}
