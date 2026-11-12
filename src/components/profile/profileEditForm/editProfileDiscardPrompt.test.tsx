/**
 * Audit 11-10 F261a (You > Edit profile): the footer said "Everything else saves when you press Save changes below"
 * while no Save bar showed (it shows only once something changed, owner VN-40), and Back or Cancel with unsaved edits
 * left without a word, keeping the edits in the form for next time. Now the sentence says the bar shows once you change
 * something, and leaving with unsaved edits asks "Discard your changes?": Discard puts the fields back to the saved
 * profile and leaves; Keep editing stays.
 *
 * @mutate src/components/profile/ProfileEditForm.tsx |   const backOrAsk = () => (dirty ? setConfirmDiscard(true) : onBack()); |   const backOrAsk = () => onBack();
 * @mutate src/components/profile/ProfileEditForm.tsx |     setBio(profile?.bio ?? ""); |     void 0;
 * @mutate src/components/profile/ProfileEditForm.tsx | , which shows at the bottom once you change something. |  below.
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

const P = { user_id: "u-1", avatar_url: null, idv_status: null, stripe_payouts_enabled: false, phone: null, location: "Delcambre", zip_code: "70528", bio: "I mow lawns and trim hedges.", skills: "", } as unknown as Profile;

function Harness({ onBack }: { onBack: () => void }) {
  const [bio, setBio] = useState(P.bio ?? "");
  return (
    <MemoryRouter initialEntries={["/profile?tab=profile"]}>
      <ProfileEditForm
        profile={P}
        firstName="Lexi" lastName="Lombas"
        phone="" setPhone={vi.fn()}
        location="Delcambre" setLocation={vi.fn()} zipCode="70528" setZipCode={vi.fn()}
        bio={bio} setBio={setBio} skills="" setSkills={vi.fn()} initials="LL"
        avatarUploading={false} saving={false} justSaved={false}
        onSave={(e) => e.preventDefault()} onAvatarUpload={vi.fn()} onBack={onBack}
      />
      <output data-testid="bio">{bio}</output>
    </MemoryRouter>
  );
}

const bioField = () => screen.getByDisplayValue(/mow lawns/);

describe("Edit profile, leaving with unsaved edits (F261a)", () => {
  it("the footer says the Save changes bar shows once something changes", () => {
    render(<Harness onBack={vi.fn()} />);
    expect(document.body.textContent).toContain("Save changes, which shows at the bottom once you change something.");
    expect(document.body.textContent).not.toMatch(/Save changes below/);
  });

  it("nothing changed: Back leaves at once, no prompt", () => {
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);
    fireEvent.click(screen.getAllByRole("button", { name: /back/i })[0]);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Discard your changes?")).toBeNull();
  });

  it("an edit then Cancel asks; Keep editing stays; Discard restores the saved bio and leaves", () => {
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);
    fireEvent.change(bioField(), { target: { value: "I mow lawns and trim hedges. Also gutters." } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByText("Discard your changes?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByTestId("bio")).toHaveTextContent("Also gutters.");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("bio").textContent).toBe(P.bio);
  });
});
