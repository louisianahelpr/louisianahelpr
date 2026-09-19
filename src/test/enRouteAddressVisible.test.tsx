/**
 * "THE ADDRESS NEEDS TO SHOW SOMEONE SO THEY KNOW WHERE THEY ARE GOING WHEN
 *  THEY SAY THEY ARE ON THEIR WAY." — owner, 2026-09-19.
 *
 * The second half of a two-part report. The first half ("directions go to the
 * town") was the fixture: every seed generator wrote a town into
 * `jobs.location`, so Directions searched a city — see
 * `src/test/seedFixtureAddressRealism.test.ts`, which stops that recurring.
 *
 * This half is a standing claim about the SCREEN, and it needs its own guard
 * because the claim is about a MOUNT, not about a component. `JobAddressLine`
 * renders correctly in isolation whether or not any card ever mounts it — the
 * exact shape `scripts/vacuity` calls class (b), and the reason the badge guard
 * in that README could not fail. So this renders the whole `AppliedJobCard`, in
 * the state a helper is in at the moment they tap "I'm On My Way", COLLAPSED,
 * and asserts the street address is on screen without expanding anything.
 *
 * AND IT ASSERTS THE LIMIT. The same line must NOT appear on a merely pending
 * application. The server is the real gate — `user_may_see_job_address` gives
 * the full column only to the poster, the hired helper, a live direct offer,
 * the group roster and an accepted applicant, and masks it to "City, ST"
 * otherwise — but a card that would print an address it was handed is one RPC
 * change away from being the leak. A guard for "is it visible?" that cannot
 * also fail on "visible to whom?" is half a guard.
 *
 * The first mutation swaps the mount for an empty fragment rather than deleting
 * it: a deletion leaves `{cond && ()}` and kills the guard with a SYNTAX error,
 * which proves nothing about what the guard checks (scripts/vacuity/README.md,
 * "a mutation that is too weak still kills a guard and tells you nothing").
 *
 * @mutate src/components/activity/AppliedJobCard.tsx | <JobAddressLine location={job.location} /> | <></>
 * @mutate src/components/activity/AppliedJobCard.tsx | {(isOffered || isConfirmed || isActive || isDisputed) && ( | {(true) && (
 * @mutate src/components/activity/appliedJobCard/JobAddressLine.tsx | {location.trim()} |
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { AppliedApp, Job } from "@/components/activity/activityConstants";

// The tracker is mocked — this file is about the card, not about what
// JobTracking draws — but it renders a marker so no assertion below can pass
// merely because the tracker failed to mount. The `personTile` slot is
// forwarded for the same reason AppliedJobCard.posterTile.test.tsx forwards it.
// Only the COMPONENT is stubbed: `deriveCurrentStatusIdx` stays the real
// export, because `ActiveJobSection` picks the step rung with it and a constant
// there would decide the very thing these cases exercise.
vi.mock("@/components/JobTracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/JobTracking")>()),
  JobTracking: ({ personTile }: { personTile?: ReactNode }) => (
    <div data-testid="tracker">{personTile}</div>
  ),
}));
vi.mock("@/components/JobConfirmation", () => ({
  JobConfirmation: () => null,
  helperDayOfConfirmation: () => true,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticLight: vi.fn(), hapticWarning: vi.fn() }));
vi.mock("@/components/activity/JobCountdown", () => ({ JobCountdown: () => null }));
vi.mock("@/components/activity/JobPetCareSheet", () => ({ JobPetCareSheet: () => null }));
vi.mock("@/components/PhotoProof", () => ({ PhotoProofGroup: () => null, PhotoProofDialog: () => null }));
// The meta row prints the CITY (and only the city) — stub it, so nothing below
// can pass on the meta row's text instead of the address line's.
vi.mock("@/components/activity/JobCardMetaRow", () => ({ JobCardMetaRow: () => <div data-testid="meta" /> }));
vi.mock("@/components/activity/useHighlightPulse", () => ({ useHighlightPulse: () => {} }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: null }) }));

import { AppliedJobCard } from "@/components/activity/AppliedJobCard";

const ADDRESS = "1103 Center St, New Iberia, LA 70560";

const baseJob = {
  id: "job-1",
  title: "Trim the hedge along the drive",
  description: "Front hedge and the two crepe myrtles.",
  category: "yard_work",
  budget: 120,
  status: "accepted",
  customer_id: "poster-1",
  helper_id: "helper-1",
  location: ADDRESS,
  date_needed: "2026-09-20",
  start_time: "09:00",
  helper_confirmed_at: "2026-09-19T12:00:00Z",
  payment_status: "escrow",
} as unknown as Job;

const noop = () => {};

function renderCard(job: Job, appOverrides: Partial<AppliedApp> = {}, expanded = false) {
  const app = {
    id: "app-1",
    job_id: "job-1",
    helper_id: "helper-1",
    status: "accepted",
    posterName: "Pierre B.",
    job,
    ...appOverrides,
  } as unknown as AppliedApp;
  // The in-progress section reaches for the query client (it reads the
  // settlement path before offering the Done tap), so the card needs a real
  // provider — one per render, retries off, so nothing leaks between cases.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
    <MemoryRouter>
      <AppliedJobCard
        app={app}
        expandedJobIds={new Set(expanded ? [job.id] : [])}
        toggleExpandedJobId={noop}
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
    </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the helper can read the job's street address at the en-route moment", () => {
  it("confirmed + COLLAPSED: the full address is on the card, above the tracker", () => {
    renderCard(baseJob);
    // The tracker is mounted — this is genuinely the en-route card, not some
    // state that happens to print an address.
    const tracker = screen.getByTestId("tracker");
    const line = screen.getByText(ADDRESS);
    expect(line).toBeInTheDocument();
    // Not inside the tracker, and before it: the address is the card's own
    // line, so it survives whatever the tracker is doing.
    expect(tracker.contains(line)).toBe(false);
    expect(line.compareDocumentPosition(tracker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Announced, not just drawn.
    expect(screen.getByText("Job address:")).toBeInTheDocument();
  });

  it("in progress + COLLAPSED: still on the card", () => {
    renderCard({ ...baseJob, status: "in_progress" } as unknown as Job, { status: "accepted" });
    expect(screen.getByText(ADDRESS)).toBeInTheDocument();
  });

  it("Directions points at that same address, and at no coordinates", () => {
    renderCard(baseJob);
    const link = screen.getByRole("link", { name: /Directions/ });
    const href = link.getAttribute("href")!;
    expect(href).toBe(`https://maps.apple.com/?q=${encodeURIComponent(ADDRESS)}`);
    // PRIVACY, load-bearing: mapsSearchUrl sends the address a poster typed
    // into a form knowing the helpr would get it — never the coordinates of
    // their front door. A lat/lng in this URL is the regression.
    expect(href).not.toMatch(/-?\d{2}\.\d+\s*,\s*-?\d{2}\.\d+/);
  });

  it("a merely PENDING application is shown no address, expanded or not", () => {
    const openJob = { ...baseJob, status: "open", helper_id: null, helper_confirmed_at: null } as unknown as Job;
    const { unmount } = renderCard(openJob, { status: "pending" });
    expect(screen.queryByText(ADDRESS)).toBeNull();
    expect(screen.queryByText("Job address:")).toBeNull();
    unmount();
    renderCard(openJob, { status: "pending" }, true);
    expect(screen.queryByText(ADDRESS)).toBeNull();
  });

  it("a job with only a town prints no address line at all", () => {
    // What every seeded job looked like before 2026-09-19. The line is not
    // drawn empty and the pin is not drawn beside nothing.
    renderCard({ ...baseJob, location: "New Iberia, LA" } as unknown as Job);
    expect(screen.getByTestId("tracker")).toBeInTheDocument();
    expect(screen.queryByText("Job address:")).toBeNull();
  });
});
