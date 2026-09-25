/**
 * OWNER, 2026-09-21, pointing at a /jobs card: "any time i click in this job
 * card, it opens apple maps. ths is not correct."
 *
 * ── WHAT WAS ACTUALLY WRONG, MEASURED ─────────────────────────────────────
 * The location slot on this card was an `<a href="https://maps.apple.com/…">`,
 * and once the card reaches a state entitled to the street address
 * (`showFullAddress`: offered / confirmed / active / disputed) that anchor
 * takes `basis-full` — a LINE OF ITS OWN inside the wrapping meta row. The
 * anchor itself carries that class, so the link box is the whole row, and
 * `py-2 -my-2` makes it 32px tall.
 *
 * Measured on prod (helper-e2e, /jobs, Chromium at 375, local build):
 * every card was 301x139 with a 267x32 live maps anchor in it — 89% of the
 * card's width, sitting directly under the title, painted exactly like the
 * plain date text beside it. 15% of the card's in-viewport area opened Apple
 * Maps. The same probe on /posts scored 0% (its anchor is the 1x1 sr-only
 * one), because My Posts already took the fix this card was denied.
 *
 * ── WHY `DirectionsButton.test.tsx`'s stopPropagation DID NOT SAVE IT ─────
 * Nothing was propagating. `e.stopPropagation()` on a maps control stops the
 * CARD from also toggling when the map opens; it cannot stop the map from
 * opening, because the anchor's own default action IS the navigation. The card
 * tap never reached the card at all — it landed on a link and left the app.
 *
 * ── THE CONTRACT THIS FILE PINS ───────────────────────────────────────────
 *   1. No VISIBLE maps link anywhere on the card. The map stays reachable, as
 *      the focus-only anchor `JobCardMetaRow` already ships for keyboard and
 *      screen-reader users, so the address chip still offers directions.
 *   2. The location control is a real <button> whose tap EXPANDS the card,
 *      like a tap on any other part of it (`locationPressToMap`, the same prop
 *      PostedJobCard has carried since 2026-09-14).
 *   3. The map is still the address, in full, and still one press away.
 *
 * jsdom computes no layout, so this file cannot re-measure the 89%. What it
 * CAN prove is the thing that made 89% possible — that the visible element in
 * the location slot is a link at all. The geometry half is measured in the
 * browser by e2e/prod-audit/card-maps-hit-area.spec.ts.
 *
 * RED on the shipped card: assertion 1 fails (the visible anchor), and so does
 * 2 (there is no button to find, and the tap does not toggle).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AppliedApp, Job } from "../../components/job-card/activityConstants";

/* The tracker opens a realtime channel; its pure derivations are kept because
   the collapsed card computes from them. Same partial mock as
   AppliedJobCard.posterTile.test.tsx. */
vi.mock("@/components/JobTracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/JobTracking")>()),
  JobTracking: () => <div data-testid="tracker" />,
}));
vi.mock("@/components/JobConfirmation", () => ({
  JobConfirmation: () => null,
  helperDayOfConfirmation: () => true,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
// The change-request control and the series dates panel read through React
// Query; this card test renders without a QueryClient and is not about them.
vi.mock("@/components/schedule/ScheduleChangeControl", () => ({ ScheduleChangeControl: () => null }));
vi.mock("@/components/series/SeriesDatesPanel", () => ({ SeriesDatesPanel: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({
  hapticError: vi.fn(),
  hapticLight: vi.fn(),
  hapticWarning: vi.fn(),
  hapticImpactForce: vi.fn(),
}));
vi.mock("@/components/job-card/JobCountdown", () => ({ JobCountdown: () => null }));
vi.mock("@/pages/jobs/JobPetCareSheet", () => ({ JobPetCareSheet: () => null }));
vi.mock("@/components/PhotoProof", () => ({ PhotoProofGroup: () => null, PhotoProofDialog: () => null }));
vi.mock("../../components/job-card/useHighlightPulse", () => ({ useHighlightPulse: () => {} }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: null }) }));
/* JobCardMetaRow is deliberately NOT mocked — it is the subject. */

import { AppliedJobCard } from "./AppliedJobCard";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

/** A real street address, so `hasStreetAddress` is true and the full-address
    branch (the one that goes `basis-full`) is the branch under test. */
const ADDRESS = "3419 Magazine St, New Orleans, LA 70115";

const job = {
  id: "job-1",
  title: "Pressure wash the driveway",
  description: "Front driveway and the walk to the porch.",
  category: "cleaning",
  budget: 120,
  // accepted + helper_confirmed_at = the Confirmed card, one of the four
  // states entitled to the street address.
  status: "accepted",
  customer_id: "poster-1",
  helper_id: "helper-1",
  location: ADDRESS,
  date_needed: jobLocalDateISO(0),
  start_time: "09:00",
  helper_confirmed_at: "2026-09-18T12:00:00Z",
  payment_status: "escrow",
} as unknown as Job;

const app = {
  id: "app-1",
  job_id: "job-1",
  helper_id: "helper-1",
  status: "accepted",
  posterName: "Pierre B.",
  job,
} as unknown as AppliedApp;

const noop = () => {};

function renderCard(toggle = vi.fn()) {
  render(
    <MemoryRouter>
      <AppliedJobCard
        app={app}
        expandedJobIds={new Set()}
        toggleExpandedJobId={toggle}
        helperReviewedJobIds={new Set()}
        userId="helper-1"
        onHelperResponse={noop}
        respondingHelperAppId={null}
        onComplete={noop}
        completingJobId={null}
        onResolveRevision={noop}
        onHelperReview={noop}
        onDispute={noop}
        onViewDispute={noop}
        onRefresh={noop}
        disputeResponse=""
        setDisputeResponse={noop}
        respondingJobId={null}
        setRespondingJobId={noop}
        submittingResponse={false}
        setSubmittingResponse={noop}
        withdrawingAppId={null}
        setWithdrawTarget={noop}
        uploadingAttachment={null}
        editingMessageAppId={null}
        setEditingMessageAppId={noop}
        editMessageText=""
        setEditMessageText={noop}
        savingMessage={false}
        handleSaveMessage={noop}
        handleAddAttachment={noop}
        handleRemoveAttachment={noop}
      />
    </MemoryRouter>,
  );
  return toggle;
}

/** Every maps target on the rendered card, whatever scheme the platform picks. */
const mapsLinks = () =>
  [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].filter((a) =>
    /^(https:\/\/maps\.apple\.com|maps:|geo:|https:\/\/(www\.)?google\.com\/maps)/.test(
      a.getAttribute("href") ?? "",
    ),
  );

describe("/jobs card: a tap opens the job, it never opens Apple Maps", () => {
  it("has no VISIBLE maps link — the only one is the focus-only accessible action", () => {
    renderCard();
    const links = mapsLinks();
    // The accessible action must still exist: "no maps link at all" is not the
    // fix, and this keeps the assertion below from passing vacuously.
    expect(links.length, "the accessible map action is gone").toBeGreaterThan(0);
    const visible = links.filter((a) => !a.classList.contains("sr-only"));
    expect(
      visible.map((a) => `${a.className} :: ${a.textContent?.trim().slice(0, 40)}`),
      "a maps link is painted in the card body, so a tap on the card leaves the app",
    ).toEqual([]);
  });

  it("the location slot is a button, and tapping it expands the card", () => {
    const toggle = renderCard();
    /* The accessible name states BOTH actions — JobCardMetaRow's own wording
       for the press-to-map control. Asking for it by role means a link in this
       slot cannot satisfy this test. */
    const chip = screen.getByRole("button", { name: /tap to expand this job/i });
    expect(chip.tagName).toBe("BUTTON");
    fireEvent.click(chip);
    // JobCardShell's wrapper onClick is what toggles; the chip must not stop it.
    expect(toggle, "a tap on the location did not open the job").toHaveBeenCalledWith("job-1");
  });

  it("the address chip still offers directions, to the FULL address", () => {
    renderCard();
    const link = mapsLinks()[0];
    expect(decodeURIComponent(link.getAttribute("href") ?? "")).toContain(ADDRESS);
    // Never the coordinates (src/lib/mapsLink.ts) — the privacy decision the
    // href carries, restated here so a rewrite cannot quietly undo it.
    expect(link.getAttribute("href")).not.toMatch(/-?\d+\.\d{3,}/);
  });

  it("still prints the whole street address where the city used to be", () => {
    renderCard();
    expect(screen.getByText(ADDRESS)).toBeInTheDocument();
  });
});

/* Shown able to fail: reverting the card to the tap-to-map anchor — i.e.
   dropping `locationPressToMap` from the call site — is the original defect,
   and it fails cases 1 and 2. */
// @mutate src/pages/jobs/AppliedJobCard.tsx | locationPressToMap | locationPressToMap={false}
