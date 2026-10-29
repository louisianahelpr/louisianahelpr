/**
 * App audit 2026-10-29 (A3-L5): Edit profile showed the stored phone raw
 * ("5045550199"). It is now shown "(504) 555-0199" (displayUsPhone). Display
 * only: the stored string is never rewritten (Profile.tsx still saves what was
 * typed), and the Save bar compares digits, so a stored "5045550199" shown as
 * "(504) 555-0199" is not a change.
 */
// @mutate src/components/profile/ProfileEditForm.tsx | value={displayUsPhone(phone)} | value={phone}
// @mutate src/components/profile/profileEditForm/isProfileEditDirty.ts |     !samePhone(values.phone, profile?.phone) \|\| |     values.phone !== (profile?.phone ?? "") \|\|
import { describe, expect, it } from "vitest";
import { displayUsPhone, samePhone } from "@/lib/smsConsent";
import { isProfileEditDirty } from "@/components/profile/profileEditForm/isProfileEditDirty";
import type { Profile } from "@/pages/profile/types";
import { blankComments } from "./helpers/blankNonCode";
import { readSource } from "./helpers/walkSource";

const stored = { phone: "5045550199", location: "Lafayette, LA", zip_code: "70501", bio: "", skills: "" } as unknown as Profile;
const values = { phone: "5045550199", location: "Lafayette, LA", zipCode: "70501", bio: "", skills: "" };

describe("the phone is shown the way people read one (A3-L5)", () => {
  it("formats a valid US number and leaves anything else as typed", () => {
    expect(displayUsPhone("5045550199")).toBe("(504) 555-0199");
    expect(displayUsPhone("+1 504-555-0199")).toBe("(504) 555-0199");
    expect(displayUsPhone("(504) 555-019")).toBe("(504) 555-019");
    expect(displayUsPhone("")).toBe("");
    expect(displayUsPhone(null)).toBe("");
  });

  it("Edit profile's phone field shows it formatted", () => {
    const form = blankComments(readSource("src/components/profile/ProfileEditForm.tsx") ?? "");
    const tag = form.slice(form.indexOf('<Input id="phone"'), form.indexOf("/>", form.indexOf('<Input id="phone"')));
    expect(tag.length).toBeGreaterThan(40);
    expect(tag).toContain("value={displayUsPhone(phone)}");
  });

  it("the same number in another format is not an unsaved change; a different number is", () => {
    expect(samePhone("(504) 555-0199", "5045550199")).toBe(true);
    expect(isProfileEditDirty({ ...values, phone: "(504) 555-0199" }, stored)).toBe(false);
    expect(isProfileEditDirty({ ...values, phone: "(504) 555-0198" }, stored)).toBe(true);
    expect(isProfileEditDirty(values, stored)).toBe(false);
  });
});
