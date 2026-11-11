/**
 * Audit 11-10 F457 (Edit profile): a ZIP left as "123" showed no words (only the tick went away) and "Save changes"
 * went grey with no reason. Now the ZIP says "ZIP is 5 digits." under the field once left (like the phone, Q2654),
 * Save waits for it, and the save bar says why it is off above the buttons. The three text fields are 48px (h-12).
 *
 * @mutate src/components/profile/ProfileEditForm.tsx |   const zipError = zipCode.length > 0 && zipCode.length < 5 ? ZIP_FIELD_ERROR : null; |   const zipError = null;
 * @mutate src/components/profile/ProfileEditForm.tsx |         blocked={!!phoneError \|\| !!zipError} |         blocked={!!phoneError}
 * @mutate src/components/profile/ProfileEditForm.tsx |         reason={saveBlockedReason} |         reason={null}
 * @mutate src/components/profile/ProfileEditForm.tsx |                     onBlur={() => setZipLeft(true)} |                     onBlur={() => undefined}
 * @mutate src/components/profile/profileEditForm/SaveBar.tsx |       {blocked && reason && ( |       {false && (
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
import type { Profile } from "./types";

const P = (o: Partial<Profile>) => ({ user_id: "u-1", avatar_url: null, idv_status: null, stripe_payouts_enabled: false, phone: null, location: "Delcambre", zip_code: "70528", bio: "", skills: "", ...o }) as unknown as Profile;

function Harness({ profile, onSave }: { profile: Profile; onSave: (e: React.FormEvent) => void }) {
  const [zipCode, setZipCode] = useState(profile.zip_code ?? "");
  return (
    <MemoryRouter initialEntries={["/profile?tab=profile"]}>
      <ProfileEditForm
        profile={profile}
        firstName="Lexi" lastName="Lombas"
        phone="" setPhone={vi.fn()}
        location="Delcambre" setLocation={vi.fn()} zipCode={zipCode} setZipCode={setZipCode}
        bio="" setBio={vi.fn()} skills="" setSkills={vi.fn()} initials="LL"
        avatarUploading={false} saving={false} justSaved={false}
        onSave={(e) => { e.preventDefault(); onSave(e); }} onAvatarUpload={vi.fn()} onBack={vi.fn()}
      />
    </MemoryRouter>
  );
}

describe("Edit profile, a short ZIP (F457)", () => {
  it('"123" shows "ZIP is 5 digits." once left, Save is off and the bar says why', () => {
    const onSave = vi.fn();
    render(<Harness profile={P({})} onSave={onSave} />);
    const zip = screen.getByLabelText("ZIP");
    fireEvent.change(zip, { target: { value: "123" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.blur(zip);
    expect(screen.getByRole("alert")).toHaveTextContent("ZIP is 5 digits.");
    expect(zip).toHaveAttribute("aria-invalid", "true");
    expect(zip.getAttribute("aria-describedby")).toBe("zip-error");

    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Fix the ZIP first: ZIP is 5 digits.");
    fireEvent.submit(zip.closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("five digits clears the words and the reason, and Save is on again", () => {
    render(<Harness profile={P({})} onSave={vi.fn()} />);
    const zip = screen.getByLabelText("ZIP");
    fireEvent.change(zip, { target: { value: "123" } });
    fireEvent.blur(zip);
    fireEvent.change(zip, { target: { value: "70508" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.querySelector("[data-save-reason]")).toBeNull();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("Phone, Area and ZIP are 48px tall (h-12), never the 40px h-10", () => {
    render(<Harness profile={P({})} onSave={vi.fn()} />);
    for (const name of ["Phone", "Area", "ZIP"]) {
      const el = screen.getByLabelText(name);
      expect(el.className, name).toMatch(/\bh-12\b/);
      expect(el.className, name).not.toMatch(/\bh-10\b/);
    }
  });
});
