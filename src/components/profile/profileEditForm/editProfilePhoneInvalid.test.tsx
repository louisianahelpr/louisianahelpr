/**
 * Q2654 (account audit 1102d row 14): on Edit profile, typing "555" in Phone and
 * leaving the field showed NO message (the check mark just went away), "Save
 * changes" stayed on, and Trust marks read "Phone ✓ Added" for the unsaved
 * text. The member learned only from the server's phone_invalid toast after
 * Save, and each refused try counted toward save_my_phone's limit.
 *
 * Now: the field shows the server's own words ("Enter a 10-digit phone
 * number.") once it is left, Save stays off (and Enter does not submit) while
 * the number is one guard_profile_phone would refuse, and Trust marks reads the
 * SAVED phone only.
 *
 * @mutate src/lib/profilePhone.ts |   return profilePhoneComplete(phone) ? null : PHONE_FIELD_ERROR; |   return null;
 * @mutate src/lib/profilePhone.ts |   return d.length === 10 \|\| (d.length === 11 && d.startsWith("1")); |   return d.length >= 10;
 * @mutate src/components/profile/ProfileEditForm.tsx |         blocked={!!phoneError} |         blocked={false}
 * @mutate src/components/profile/ProfileEditForm.tsx |     if (phoneError) { |     if (false) {
 * @mutate src/components/profile/ProfileEditForm.tsx | onBlur={() => setPhoneLeft(true)} | onBlur={() => undefined}
 * @mutate src/components/profile/ProfileEditForm.tsx | <TrustMarksCard profile={profile} phone={profile?.phone ?? ""} /> | <TrustMarksCard profile={profile} phone={phone} />
 * @mutate src/components/profile/profileEditForm/SaveBar.tsx | disabled={saving \|\| justSaved \|\| blocked} | disabled={saving \|\| justSaved}
 */
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/components/help/HelpEntry", () => ({ HelpEntry: () => null }));
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => false }));
vi.mock("@/hooks/useParishForZip", () => ({ useParishForZip: () => ({ parish: null, unknownZip: false }), UNKNOWN_ZIP_MESSAGE: "x" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { ProfileEditForm } from "../ProfileEditForm";
import { profilePhoneError, PHONE_FIELD_ERROR } from "@/lib/profilePhone";
import type { Profile } from "./types";

const P = (o: Partial<Profile>) => ({ user_id: "u-1", avatar_url: null, idv_status: null, stripe_payouts_enabled: false, phone: null, location: "Delcambre", zip_code: "70528", bio: "", skills: "", ...o }) as unknown as Profile;
const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");

function Harness({ profile, onSave }: { profile: Profile; onSave: (e: React.FormEvent) => void }) {
  const [phone, setPhone] = useState(profile.phone ?? "");
  return (
    <MemoryRouter initialEntries={["/profile?tab=profile"]}>
      <ProfileEditForm
        profile={profile}
        firstName="Lexi" lastName="Lombas"
        phone={phone} setPhone={setPhone}
        location="Delcambre" setLocation={vi.fn()} zipCode="70528" setZipCode={vi.fn()}
        bio="" setBio={vi.fn()} skills="" setSkills={vi.fn()} initials="LL"
        avatarUploading={false} saving={false} justSaved={false}
        onSave={(e) => { e.preventDefault(); onSave(e); }} onAvatarUpload={vi.fn()} onBack={vi.fn()}
      />
    </MemoryRouter>
  );
}

function typePhone(value: string) {
  const input = screen.getByLabelText("Phone");
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
  return input;
}

describe("the phone rule matches the server's guard_profile_phone", () => {
  it("empty clears, 10 digits or 1+10 save, anything else is refused", () => {
    expect(profilePhoneError("")).toBeNull();
    expect(profilePhoneError("(504) 555-0199")).toBeNull();
    expect(profilePhoneError("1 504 555 0199")).toBeNull();
    expect(profilePhoneError("555")).toBe(PHONE_FIELD_ERROR);
    expect(profilePhoneError("504555019912")).toBe(PHONE_FIELD_ERROR);
    expect(profilePhoneError("25045550199")).toBe(PHONE_FIELD_ERROR);
  });
});

describe("Edit profile, an invalid phone (Q2654)", () => {
  it('"555" shows the words under the field once left, and Save stays off', () => {
    const onSave = vi.fn();
    render(<Harness profile={P({})} onSave={onSave} />);
    const input = typePhone("555");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a 10-digit phone number.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe("phone-error");
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    // Enter in a field submits the form: that is held too.
    fireEvent.submit(input.closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("12 digits are refused too (the old >= 10 check let them through)", () => {
    render(<Harness profile={P({})} onSave={vi.fn()} />);
    typePhone("504555019912");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("a valid number shows no error and Save is on", () => {
    const onSave = vi.fn();
    render(<Harness profile={P({})} onSave={onSave} />);
    typePhone("5045550199");
    expect(screen.queryByRole("alert")).toBeNull();
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("clearing the phone is allowed (no error; Save on)", () => {
    render(<Harness profile={P({ phone: "5045550199" })} onSave={vi.fn()} />);
    typePhone("");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });
});

describe("Trust marks reads the SAVED phone, never the typed text (Q2654)", () => {
  it("no saved phone: typed text (valid or not) still reads Add", () => {
    render(<Harness profile={P({})} onSave={vi.fn()} />);
    typePhone("555");
    expect(text()).not.toContain("PhoneAdded");
    typePhone("5045550199");
    expect(text()).not.toContain("PhoneAdded");
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("a saved phone reads Added", () => {
    render(<Harness profile={P({ phone: "5045550199" })} onSave={vi.fn()} />);
    expect(text()).toContain("PhoneAdded");
  });
});
