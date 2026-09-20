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
 * ── THE ADDRESS MOVED INTO THE META ROW, AND SO DID THIS FILE'S TARGET ────
 * Owner, 2026-09-19, later the same day, with a screenshot: "this shouldnt
 * show 2 addresses… the full address needs to go where the city place is. not
 * be on a whole nother line." `JobAddressLine` printed the street address on a
 * row of its own while `JobCardMetaRow` printed the city directly above it, so
 * an en-route Helpr's card said the place twice. The row is deleted and the
 * address now fills the meta row's location slot.
 *
 * Every claim here survives that move unchanged — the address is still on the
 * COLLAPSED card, a pending applicant is still shown none of it, and Directions
 * still points at the address and never at coordinates. What changes is that
 * this file may no longer STUB the meta row: it used to, precisely because the
 * row could only print a city and stubbing it proved the assertion was reading
 * the address line. Now the meta row IS the address line, so it renders for
 * real and the mutations below are what stop this passing vacuously.
 *
 * @mutate src/components/activity/AppliedJobCard.tsx | showFullAddress={isOffered || isConfirmed || isActive || isDisputed} | showFullAddress={false}
 * @mutate src/components/activity/AppliedJobCard.tsx | showFullAddress={isOffered || isConfirmed || isActive || isDisputed} | showFullAddress
 * @mutate src/components/activity/JobCardMetaRow.tsx | const fullAddress = showFullAddress && hasStreetAddress(location); | const fullAddress = false;
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
/* THE META ROW IS NO LONGER STUBBED. It used to be, so that nothing here could
   pass on the row's city instead of the address line's street. The address
   line is gone and the row is where the street now prints, so stubbing it
   would stub the very thing under test. What stops this passing vacuously is
   the mutation register above: the two `showFullAddress` mutations flip the
   card's own gate in both directions, and the third makes the row print a city
   whatever it is handed. */
vi.mock("@/components/activity/useHighlightPulse", () => ({ useHighlightPulse: () => {} }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ profile: null }) }));

import { AppliedJobCard } from "@/components/activity/AppliedJobCard";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

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
  date_needed: jobLocalDateISO(0),
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
  /* THE CLAIM IS UNCHANGED AND THE CARD AROUND IT MOVED.
     Owner, 2026-09-19, later the same day: a Jobs card collapses like a Posts
     card, so the FULL tracker (and the action row with it) went behind the
     expand — and the owner carved this line out by name when they ruled,
     BECAUSE of this guard: "a Helpr heading out should not have to expand a
     card to see where they are going."

     So the address assertion is byte-for-byte what it was. What moves is the
     element it is measured against: the collapsed card now carries a STATUS
     STRIP where the full tracker used to be, and the address must still come
     before it and sit outside it. That is the same structural claim — the
     address is the CARD's own line, not the progress block's — against the
     element that is actually there. (It was the compact 16px dot rail for a
     few hours on 2026-09-19; the owner replaced the dots with the sentence.) */
  it("confirmed + COLLAPSED: the full address is on the card, above the status line", () => {
    renderCard(baseJob);
    // A progress block IS mounted — this is genuinely the en-route card, not
    // some state that happens to print an address.
    const progress = document.querySelector("[data-job-status-strip]")!;
    expect(progress, "no status line on the collapsed card — re-check the fixture").not.toBeNull();
    expect(screen.queryByTestId("tracker"), "the full tracker is back on a collapsed card").toBeNull();
    const line = screen.getByText(ADDRESS);
    expect(line).toBeInTheDocument();
    // Not inside the progress block, and before it.
    expect(progress.contains(line)).toBe(false);
    expect(line.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Announced, not just drawn — the noun the deleted row's sr-only carried.
    expect(screen.getByText("Job address:")).toBeInTheDocument();
    // AND IT IS SAID ONCE. The whole report was that it was said twice: the
    // city in the meta row and the street on a row of its own beneath it.
    expect(
      screen.getAllByText((_t, el) => el?.textContent?.trim() === ADDRESS && el.children.length === 0),
      "the address is printed more than once on one card",
    ).toHaveLength(1);
  });

  it("in progress + COLLAPSED: still on the card", () => {
    renderCard({ ...baseJob, status: "in_progress" } as unknown as Job, { status: "accepted" });
    expect(screen.getByText(ADDRESS)).toBeInTheDocument();
  });

  /* EXPANDED, because that is where the control lives now. The Directions chip
     is in the step card's action row, and the action row went behind the
     expand with the tracker (owner, 2026-09-19). The ADDRESS is the thing the
     owner carved out of that gate, not the chip — a Helpr reads where they are
     going from the collapsed card and opens the card to act on it. The URL
     claim this case exists for is unchanged. */
  it("Directions points at that same address, and at no coordinates", () => {
    renderCard(baseJob, {}, true);
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
    // The card DID render its progress block — so "no street address" is a
    // decision about the address, not a card that failed to mount.
    expect(document.querySelector("[data-job-status-strip]")).toBeInTheDocument();
    expect(screen.queryByText("Job address:")).toBeNull();
    // The town is still printed, exactly as it always was.
    expect(screen.getByText("New Iberia")).toBeInTheDocument();
  });
});
