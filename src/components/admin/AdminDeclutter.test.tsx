import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

/**
 * Design audit area 10 #2 (11-18): the Declutter admin cards moved from the bottom of Settings to their own Queues
 * view, unchanged. Audit 1028 part 2, D2-4 still holds there: the review card's "Show test listings" also shows test
 * accounts' problems. The probes show what each card is given (the cards' own reads have their own tests).
 */
// @mutate src/components/admin/AdminDeclutter.tsx |       <DeclutterProblemsCard includeTest={showTest} /> |       <DeclutterProblemsCard />
// @mutate src/components/admin/AdminDeclutter.tsx | <DeclutterReviewCard showTest={showTest} onShowTestChange={setShowTest} /> | <DeclutterReviewCard />
// @mutate src/components/admin/AdminDeclutter.tsx |       <MeetupSpotsCard />\n |
vi.mock("./settings/DeclutterReviewCard", () => ({
  DeclutterReviewCard: ({ showTest, onShowTestChange }: { showTest?: boolean; onShowTestChange?: (on: boolean) => void }) => (
    <button type="button" aria-pressed={!!showTest} onClick={() => onShowTestChange?.(!showTest)}>Show test listings (probe)</button>
  ),
}));
vi.mock("./settings/DeclutterProblemsCard", () => ({
  DeclutterProblemsCard: ({ includeTest }: { includeTest?: boolean }) => <p>Problems include test: {String(includeTest)}</p>,
}));
vi.mock("./settings/MeetupSpotsCard", () => ({ MeetupSpotsCard: () => <p>Meetup spots (probe)</p> }));
vi.mock("./settings/DeclutterShippingClaimsCard", () => ({ DeclutterShippingClaimsCard: () => <p>Claims (probe)</p> }));
vi.mock("./settings/DonationPartnersCard", () => ({ DonationPartnersCard: () => <p>Partners (probe)</p> }));
vi.mock("./settings/DeclutterFunnelCard", () => ({ DeclutterFunnelCard: () => <p>Funnel (probe)</p> }));
vi.mock("./settings/DeclutterPreviewCard", () => ({ DeclutterPreviewCard: () => <p>Preview (probe)</p> }));

import AdminDeclutter from "./AdminDeclutter";

afterEach(() => cleanup());

describe("AdminDeclutter", () => {
  it("renders every Declutter card", () => {
    render(<AdminDeclutter />);
    for (const t of ["Meetup spots (probe)", "Claims (probe)", "Partners (probe)", "Funnel (probe)", "Preview (probe)"]) {
      expect(screen.getByText(t)).toBeTruthy();
    }
  });

  it("D2-4: the review card's \"Show test listings\" also shows test accounts' problems", async () => {
    render(<AdminDeclutter />);
    expect(await screen.findByText("Problems include test: false")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show test listings (probe)" }));
    expect(await screen.findByText("Problems include test: true")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show test listings (probe)" }).getAttribute("aria-pressed")).toBe("true");
  });
});
