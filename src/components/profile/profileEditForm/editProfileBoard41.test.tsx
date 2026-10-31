/**
 * Board 41 (You → Edit profile): Preview in the header, "Neighbors see First L."
 * under the name, "Area" with "Shown as an area, never your address.", "I can
 * help with" over the skills, and the TRUST MARKS card (phone, photo ID,
 * payout bank), each with its state and next step.
 *
 * @mutate src/components/profile/profileEditForm/TrustMarksCard.tsx |     view === "verified" |     view === "never"
 * @mutate src/components/profile/profileEditForm/TrustMarksCard.tsx |     profile?.stripe_payouts_enabled\n      ? { key: "bank" |     false\n      ? { key: "bank"
 * @mutate src/components/profile/profileEditForm/TrustMarksCard.tsx | const idUnderWay = idOn && (view === "checking" \|\| view === "with_team"); | const idUnderWay = true;
 * @mutate src/components/profile/profileEditForm/TrustMarksCard.tsx |     phone.trim() |     ""
 * @mutate src/components/profile/profileEditForm/PhotoNameSection.tsx | Neighbors see &ldquo;{formatName(`${firstName} ${lastName}`)}&rdquo; | Neighbors see &ldquo;{`${firstName} ${lastName}`}&rdquo;
 * @mutate src/components/profile/ProfileEditForm.tsx |             onClick={() => navigate(`/user/${profile.user_id}`)} |             onClick={() => navigate(`/profile`)}
 * @mutate src/components/profile/ProfileEditForm.tsx |         <TrustMarksCard profile={profile} phone={phone} /> |
 */
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { setIdentityCheckOn } from "@/lib/identityCheckSwitch";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const idCheck = vi.hoisted(() => ({ opened: [] as string[] }));
// Payout setup OPEN here (owner pause of 2026-10-23 is the `payout_setup` switch):
// this file tests the setup flow itself; the paused state is
// src/components/payouts/payoutSetupPaused.test.tsx.
vi.mock("@/components/help/HelpEntry", () => ({ HelpEntry: () => null })); // Its top bar's Help needs the app's providers.
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => false }));
vi.mock("@/lib/identityCheck", async (orig) => ({
  ...(await orig<typeof import("@/lib/identityCheck")>()),
  openIdentityCheck: (r: string) => idCheck.opened.push(r),
}));
vi.mock("@/hooks/useParishForZip", () => ({ useParishForZip: () => ({ parish: null, unknownZip: false }), UNKNOWN_ZIP_MESSAGE: "x" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { TrustMarksCard } from "./TrustMarksCard";
import { ProfileEditForm } from "../ProfileEditForm";
import type { Profile } from "./types";

// These cases test the ID check while it is ON. The owner switched it off on
// 2026-10-23 (switch `identity_check`); src/test/identityCheckOffEntryPoints.test.ts
// covers the off state.
vi.mock("@/hooks/useIdentityCheckOn", () => ({ useIdentityCheckOn: () => true, useIdentityCheckStatus: () => ({ on: true, settled: true }) }));
beforeEach(() => setIdentityCheckOn(true));
afterEach(() => setIdentityCheckOn(false));

let at = "";
function Where() {
  at = `${useLocation().pathname}${useLocation().search}`;
  return null;
}
function inRouter(ui: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={["/profile?tab=profile"]}>
      <Routes>
        <Route path="/profile" element={<>{ui}<Where /></>} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}
const P = (o: Partial<Profile>) => ({ user_id: "u-1", avatar_url: null, idv_status: null, stripe_payouts_enabled: false, ...o }) as unknown as Profile;
const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");

beforeEach(() => {
  idCheck.opened.length = 0;
  at = "";
});

describe("TRUST MARKS (board 41)", () => {
  it("all three done: Added, Done, Done", () => {
    inRouter(<TrustMarksCard profile={P({ idv_status: "verified", stripe_payouts_enabled: true })} phone="(337) 555-0142" />);
    expect(text()).toContain("PhoneAdded");
    expect(text()).toContain("Photo IDDone");
    expect(text()).toContain("Payout bankDone");
  });

  it("nothing done: each row is its next step", () => {
    inRouter(<TrustMarksCard profile={P({})} phone="" />);
    // Never an ask (owner 2026-10-30): no Photo ID row until there is a check to report.
    expect(text()).not.toContain("Photo ID");
    expect(idCheck.opened).toEqual([]);
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    expect(at).toBe("/profile?tab=earnings");
  });

  it("an ID check under way says Checking and offers nothing to press", () => {
    inRouter(<TrustMarksCard profile={P({ idv_status: "manual_review" })} phone="" />);
    expect(text()).toContain("Photo IDChecking");
    expect(screen.queryByRole("button", { name: "Verify now" })).toBeNull();
  });
});

describe("the edit form (board 41)", () => {
  const props = {
    profile: P({ idv_status: "verified" }),
    firstName: "Lexi", lastName: "Lombas",
    phone: "", setPhone: vi.fn(), location: "Delcambre", setLocation: vi.fn(), zipCode: "70528", setZipCode: vi.fn(),
    bio: "", setBio: vi.fn(), skills: "", setSkills: vi.fn(), initials: "LL",
    avatarUploading: false, saving: false, justSaved: false, onSave: vi.fn(), onAvatarUpload: vi.fn(), onBack: vi.fn(),
  };

  it("says what neighbors see of the name, names the area and the skills as the board does", () => {
    inRouter(<ProfileEditForm {...props} />);
    expect(text()).toContain("Neighbors see “Lexi L.” Your full name stays private.");
    expect(screen.getByLabelText("Area")).toBeInTheDocument();
    expect(text()).toContain("Shown as an area, never your address.");
    expect(screen.getByText("I can help with")).toBeInTheDocument();
    expect(text()).toContain("Trust marks");
  });

  it("Preview opens the profile as neighbors see it", () => {
    inRouter(<ProfileEditForm {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(at).toBe("/user/u-1");
  });
});
