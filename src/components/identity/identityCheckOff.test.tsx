/**
 * ID check OFF (owner ruling 2026-10-23, switch `identity_check`): the places a
 * member met "Verify your ID" show nothing about it, and nothing reads as
 * "ID verified" for a member who never verified. Each case has an ON twin, so a
 * component that always (or never) shows the ask fails.
 * Class guard (every ask/claim reads the switch): src/test/identityCheckOffEntryPoints.test.ts.
 *
 * @mutate src/components/profile/profileEditForm/TrustMarksCard.tsx |   const rows = allRows.filter((r) => r.key !== "id" \|\| r.done \|\| idUnderWay); |   const rows = allRows;
 * @mutate src/components/identity/IdentityPromptCard.tsx |   if (!idOn \|\| view === "verified") return null; |   if (view === "verified") return null;
 * @mutate src/components/landing/LandingProof.tsx |   return [idOn ? ID_ITEM : PICK_ITEM, PRICE_ITEM]; |   return [ID_ITEM, PRICE_ITEM];
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { setIdentityCheckOn } from "@/lib/identityCheckSwitch";
import { openIdentityCheck, needsIdentityCheck } from "@/lib/identityCheck";
import { acceptMissingFromProfile } from "@/lib/awardGate";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
// Payout setup open here: this file is about the ID check (payout pause: src/components/payouts/payoutSetupPaused.test.tsx).
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => false }));

import { TrustMarksCard } from "@/components/profile/profileEditForm/TrustMarksCard";
import { IdentityPromptCard } from "@/components/identity/IdentityPromptCard";
import { LandingProof } from "@/components/landing/LandingProof";
import type { Profile } from "@/components/profile/profileEditForm/types";

afterEach(() => {
  cleanup();
  setIdentityCheckOn(false);
});

const UNVERIFIED = { idv_status: "not_started", stripe_payouts_enabled: true } as unknown as Profile;
const inRouter = (n: React.ReactNode) => render(<MemoryRouter>{n}</MemoryRouter>);

describe("ID check off", () => {
  it("Trust marks: no Photo ID row for an unverified member, on or off (owner 2026-10-30: never an ask)", () => {
    inRouter(<TrustMarksCard profile={UNVERIFIED} phone="(337) 555-0142" />);
    expect(screen.queryByText("Photo ID")).toBeNull();
    cleanup();
    setIdentityCheckOn(true);
    inRouter(<TrustMarksCard profile={UNVERIFIED} phone="(337) 555-0142" />);
    expect(screen.queryByText("Verify now")).toBeNull();
    expect(screen.queryByText("Photo ID")).toBeNull();
  });

  it("Trust marks: a member who really verified still reads Done", () => {
    inRouter(<TrustMarksCard profile={{ ...UNVERIFIED, idv_status: "verified" } as Profile} phone="" />);
    expect(screen.getByText("Photo ID")).toBeTruthy();
  });

  it("the Home / job-card ID prompt draws nothing (on: it asks)", () => {
    const { container } = render(<IdentityPromptCard idvStatus="not_started" />);
    expect(container.textContent).toBe("");
    cleanup();
    setIdentityCheckOn(true);
    render(<IdentityPromptCard idvStatus="not_started" />);
    expect(screen.getByText(/verify your id/i)).toBeTruthy();
  });

  it("the landing proof row claims no ID check (on: 'Photo ID checked')", () => {
    render(<LandingProof />);
    expect(document.body.textContent).not.toMatch(/photo id checked|verified id/i);
    cleanup();
    setIdentityCheckOn(true);
    render(<LandingProof />);
    expect(document.body.textContent).toMatch(/photo id checked/i);
  });

  it("the shared functions: the sheet does not open, nobody needs the check, accept never waits on the ID", () => {
    expect(openIdentityCheck("post")).toBe(false);
    expect(needsIdentityCheck({ idv_status: "not_started", is_seed: false })).toBe(false);
    expect(acceptMissingFromProfile({ stripe_account_id: "acct_x", stripe_payouts_enabled: true, idv_status: "not_started" })).toEqual([]);
    setIdentityCheckOn(true);
    expect(needsIdentityCheck({ idv_status: "not_started", is_seed: false })).toBe(true);
    expect(acceptMissingFromProfile({ stripe_account_id: "acct_x", stripe_payouts_enabled: true, idv_status: "not_started" })).toEqual(["stripe_id"]);
    expect(openIdentityCheck("post")).toBe(true);
  });
});
