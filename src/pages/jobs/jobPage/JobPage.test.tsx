/**
 * The signed-in job page (/jobs/:id, boards 15, 42, 168, 169; J2).
 *
 * - The page renders for a signed-in member instead of bouncing them to
 *   /home?quickApply=<id>, and its Apply button is what opens that quick-apply
 *   sheet now (the behaviour stays reachable from the page's primary action).
 * - Poster side: the money line is the TRUE charge moment (jobs charge at
 *   post, design-b measured): "Paid when you posted...", never "Nothing is
 *   charged until then"; an unpaid post says Helprs can't see it; a state we
 *   have not verified prints nothing. Never the Helpr's take-home.
 * - Helpr side: always their take-home: the 5% + 70c stamp on a fee-stamped
 *   job, the viewer's own tier rate on an older unstamped one (the feed's rule),
 *   and the whole price on a poster-fee job.
 * - Tracker: four steps from jobs.status; none for a Helpr just browsing.
 * The data hook is stubbed (no Supabase mock): these check what each state renders.
 *
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |               ? `/posts?highlight=${encodeURIComponent(job.id)}&applicants=1` |               ? `/posts?highlight=${encodeURIComponent(job.id)}`
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |         {hasPhoto && ( |         {true && (
 * @mutate src/pages/jobs/JobDetail.tsx |         <JobPage id={id} userId={user.id} /> |         <Navigate to={`/home?quickApply=${id}`} replace />
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |         ? { label: "Apply", go: () => navigate(`/home?quickApply=${encodeURIComponent(job.id)}`) } |         ? { label: "Apply", go: () => navigate("/jobs") }
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |   escrow: "Paid when you posted. We hold it until the job is done.", |   escrow: "Nothing is charged until you hire.",
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |   const line = job.payment_status === "escrow" && cardHoldOn ? PAID_UNDER_CARD_HOLD : | const line =
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |   held: "Your card isn't charged until you hire someone.", |
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |   const net = computeNet(job.budget, tierPct, |   const net = computeNet(job.budget, 0,
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |   if (!side) return null; |   if (false) return null;
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |         {isPoster && open && (job.payment_status === "escrow" \|\| job.payment_status === "held") && | {isPoster && open &&
 * @mutate src/pages/jobs/jobPage/NoApplicantsYet.tsx |         {reach && reach > 0 |         {reach !== null
 * @mutate src/pages/jobs/jobPage/NoApplicantsYet.tsx |     !(job.photos ?? []).length && { key: "photo" |     false && { key: "photo"
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |     showStreet && hasStreetAddress(job.location) ? job.location : job.location |     job.location
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |   const meta = metaLine(job, isHired && STREET_STATUSES.has(job.status ?? "")); |   const meta = metaLine(job, !isPoster);
 * @mutate src/pages/jobs/jobPage/JobPage.tsx |           {!isPoster && !isHired && <p className="text-ds-13 text-muted-foreground">The street address is shared once you're offered the job.</p>} |
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { JobPageRow } from "./useJobPage";

const state = {
  job: null as JobPageRow | null,
  reach: null as number | null,
  party: false,
  applicants: { total: 0, pending: 0 },
  owed: 0,
  myApplication: null as { status: string; closed_reason: string | null } | null,
  cardHold: false,
};

vi.mock("./useJobPage", () => ({
  useJobPage: (_id: string, userId: string) => ({
    job: { isLoading: false, isError: false, data: state.job ? { job: state.job, party: state.party } : null, refetch: vi.fn() },
    applicants: { isLoading: false, data: state.applicants },
    isPoster: !!state.job && state.job.customer_id === userId,
    myApplication: { data: state.myApplication },
  }),
}));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => state.owed }));
// The Helpr Guarantee panel's read (no claim on these jobs); its own behaviour is helprGuarantee.test.ts and the PGlite proof.
vi.mock("@/lib/guarantee", async (orig) => ({ ...(await orig<typeof import("@/lib/guarantee")>()), fetchGuaranteeClaim: async () => null }));
vi.mock("@/lib/declutter/api", () => ({
  fetchSellerCard: async () => ({ name: "Rhonda Dupre", avatarUrl: null, joinedAt: "2025-03-10T12:00:00Z" }),
  fetchSellerRating: async () => null,
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: ME_ID }, profile: null, isLoading: false, profileQuery: {}, refresh: vi.fn() }),
}));
vi.mock("@/hooks/usePendingSaveConsumer", () => ({ usePendingSaveConsumer: () => undefined }));
vi.mock("@/hooks/useJobRef", () => ({ useJobRef: () => undefined }));
// Board 184: the reach read is a hidden-switch RPC; the tests set it through state.reach.
vi.mock("./useJobReach", () => ({ useJobReach: () => state.reach }));
// An accepted (offered) job asks whether it was rescheduled; these jobs never were.
vi.mock("@/hooks/useJobRescheduled", () => ({ useJobRescheduled: () => false }));
// Q2399 card_hold_at_post: the poster's money line follows it (F4).
vi.mock("@/hooks/useFeature", () => ({ useFeature: (key: string) => key === "card_hold_at_post" && state.cardHold }));
vi.mock("@/hooks/useFeedPhase", () => ({ useFeedPhase: () => "ready", useProfileWaitPhase: () => "ready" }));

import JobPage from "./JobPage";
import { formatJobDate } from "@/lib/dateUtils";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

/** A day ahead, never a literal that ages into the past (jobDayFixtureTimezone). */
const DAY = jobLocalDateISO(11);
import { tierFeePercent } from "@/lib/subscriptionTiers";
import JobDetail from "../JobDetail";

const ME = "11111111-1111-1111-1111-111111111111";
// Hoisted for the useCurrentUser mock (vi.mock factories run before the module body).
var ME_ID = "11111111-1111-1111-1111-111111111111"; // eslint-disable-line no-var
const POSTER = "22222222-2222-2222-2222-222222222222";

function row(over: Partial<JobPageRow> = {}): JobPageRow {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    title: "Pressure wash driveway",
    description: "Two-car concrete driveway and the front walk.",
    category: "pressure_washing",
    budget: 90,
    date_needed: DAY,
    start_time: "09:00",
    is_flexible_schedule: false,
    location: "123 Main St, Delcambre, LA 70528",
    customer_id: POSTER,
    helper_id: null,
    status: "open",
    payment_status: "escrow",
    urgent_fee: null,
    helpers_needed: 1,
    is_group_job: false,
    photos: [],
    helper_fee_flat_cents: 70,
    helper_fee_percent: 5,
    poster_fee_flat_cents: null,
    ...over,
  };
}

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function renderPage(userId = ME) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/jobs/x"]}>
        <Routes>
          <Route path="/jobs/x" element={<JobPage id="x" userId={userId} />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.job = null;
  state.party = false;
  state.applicants = { total: 0, pending: 0 };
  state.myApplication = null;
  state.owed = 0;
  state.cardHold = false;
});

describe("job page, Helpr side (boards 42, 169)", () => {
  // Audit #8: a job with no photo shows no placeholder band (it read as a maroon block); a real photo shows.
  it("no photo, no band; a real photo, the gallery", () => {
    state.job = row();
    const { unmount } = renderPage();
    expect(document.querySelector("[data-job-photos]")).toBeNull();
    unmount();
    state.job = row({ photos: ["https://example.test/a.jpg"] });
    renderPage();
    expect(document.querySelector("[data-job-photos]")).not.toBeNull();
  });

  // Owner bug 2026-10-21: a member who already applied saw "Apply". Now: the applied state and View application.
  it("an applicant sees 'You applied · Waiting on Rhonda' and View application, never Apply", async () => {
    state.job = row();
    state.myApplication = { status: "pending", closed_reason: null };
    renderPage();
    expect(await screen.findByText("You applied · Waiting on Rhonda")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View application" }));
    expect(screen.getByTestId("where").textContent).toContain("/jobs?tab=working");
  });

  it("shows the real take-home (no fee named), the city only, and Apply opens the quick-apply sheet", () => {
    state.job = row();
    renderPage();
    // $90 - (5% of $90 + 70c) = $84.80, floored to whole dollars on the headline (owner, 2026-08-19).
    expect(screen.getByText("You take home")).toBeTruthy();
    expect(screen.getByText("$84")).toBeTruthy();
    // Owner 2026-10-25: no fee name, rate or maths beside the take-home.
    expect(document.querySelector("[data-helpr-money]")?.textContent ?? "").not.toMatch(/fee|%/i);
    expect(screen.getByText(`${formatJobDate(DAY)} · 9:00 AM · Delcambre`)).toBeTruthy();
    expect(document.body.textContent).not.toContain("123 Main St");
    expect(screen.getByText("The street address is shared once you're offered the job.")).toBeTruthy();
    expect(screen.getByText("Home · Pressure washing")).toBeTruthy();
    // A Helpr browsing an open job is not on it yet: no tracker.
    expect(document.querySelector("[data-job-tracker]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByTestId("where").textContent).toBe(`/home?quickApply=${row().id}`);
  });

  it("an unstamped (older) job shows the take-home at the viewer's own tier rate", () => {
    state.job = row({ helper_fee_flat_cents: null, helper_fee_percent: null, budget: 60 });
    renderPage();
    const pct = tierFeePercent(undefined, undefined);
    expect(pct).toBeGreaterThan(0);
    expect(screen.getByText("You take home")).toBeTruthy();
    expect(screen.getByText(`$${Math.floor(60 - (60 * pct) / 100)}`)).toBeTruthy();
    expect(document.querySelector("[data-helpr-money]")?.textContent ?? "").not.toMatch(/fee|%/i);
  });

  it("a poster-fee job: the Helpr keeps the whole price", () => {
    state.job = row({ helper_fee_flat_cents: 0, helper_fee_percent: 0, poster_fee_flat_cents: 520 });
    renderPage();
    expect(screen.getByText("$90")).toBeTruthy();
    expect(document.querySelector("[data-helpr-money]")?.textContent ?? "").not.toMatch(/fee|%/i);
  });
});

describe("job page, poster side (boards 15, 168)", () => {
  it("says the money was paid at post and is held, counts applicants, and reviews them in Posted", () => {
    state.job = row({ customer_id: ME });
    state.party = true;
    state.applicants = { total: 3, pending: 2 };
    renderPage();
    expect(screen.getByText("Your budget")).toBeTruthy();
    expect(screen.getByText("Paid when you posted. We hold it until the job is done.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Nothing is charged|take home|takes home/i);
    expect(screen.getByText("3 applicants")).toBeTruthy();
    expect(screen.getByLabelText(/^Job progress, step 1 of 8: Posted,/)).toBeTruthy();
    expect(screen.getByText("Pick your Helpr")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review 2 applicants" }));
    expect(screen.getByTestId("where").textContent).toBe(`/posts?highlight=${row().id}&applicants=1`);
  });

  // Audit 2026-10-28 F4: with card_hold_at_post on, the card is charged at the hire, so a paid job's line
  // never says "when you posted"; a job whose card is only held says it is not charged yet.
  it("under the card hold: 'Paid. We hold it…', and a held card is not charged until the hire", () => {
    state.cardHold = true;
    state.job = row({ customer_id: ME, helper_id: "44444444-4444-4444-4444-444444444444", status: "in_progress", helper_confirmed_at: "2026-10-20T12:00:00Z" });
    state.party = true;
    const { unmount } = renderPage();
    expect(screen.getByText("Paid. We hold it until the job is done.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("when you posted");
    unmount();
    state.job = row({ customer_id: ME, payment_status: "held" });
    renderPage();
    expect(screen.getByText("Your card isn't charged until you hire someone.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Paid when you posted|You're charged when you post/);
  });

  it("an unpaid post says Helprs can't see it; an unverified money state prints nothing", () => {
    state.job = row({ customer_id: ME, payment_status: "abandoned" });
    state.party = true;
    const { unmount } = renderPage();
    expect(screen.getByText("Not paid yet. Helprs can't see this job until it's paid.")).toBeTruthy();
    unmount();
    state.job = row({ customer_id: ME, status: "completed", payment_status: "payout_pending" });
    renderPage();
    expect(document.querySelector("[data-poster-money] p.mt-1\\.5")).toBeNull();
    expect(screen.getByLabelText(/^Job progress: all 8 steps done/)).toBeTruthy();
  });

  it("a cancelled job says so instead of drawing a tracker", () => {
    state.job = row({ customer_id: ME, status: "cancelled", payment_status: "refunded" });
    state.party = true;
    renderPage();
    // The one tracker (owner 2026-10-21): off the path it is the line alone, no step bar.
    expect(screen.getByText(/This job was cancelled/)).toBeTruthy();
    expect(screen.getByText("Refunded to your card.")).toBeTruthy();
    // No misleading progress colour (lead review 2026-10-22): an all-grey bar that says Cancelled.
    expect(screen.getByLabelText(/^Job progress: Cancelled/).getAttribute("data-tone")).toBe("cancelled");
  });
});

describe("job page, the hired Helpr", () => {
  it("sees the tracker with their next step and opens the job in Working; no address note", () => {
    state.job = row({ helper_id: ME, status: "in_progress", helper_confirmed_at: "2026-10-20T12:00:00Z", poster_confirmed_arrival_at: "2026-10-21T12:00:00Z" });
    state.party = true;
    renderPage();
    expect(screen.getByLabelText(/^Job progress, step 7 of 8: Working, waiting on you\./)).toBeTruthy();
    expect(screen.getByText("Mark it done when you finish")).toBeTruthy();
    expect(screen.queryByText("The street address is shared once you're offered the job.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open in working" }));
    expect(screen.getByTestId("where").textContent).toBe("/jobs?tab=working");
  });
});

// Audit 2026-10-28 F7: the offer card in Working printed the street while the job page said only the
// city. Owner rule 2026-08-31 ("Should only see address when they are offered the job"): the offered
// Helpr sees the street on both; a Helpr who only applied sees the city and the line saying when.
describe("job page, the street address follows the Working card", () => {
  it("the offered Helpr sees the street the offer card shows, and no 'shared once' line", () => {
    state.job = row({ helper_id: ME, status: "accepted", helper_confirmed_at: null });
    state.party = true;
    renderPage();
    expect(document.querySelector("[data-viewer-status]")?.textContent).toMatch(/offered you this job$/);
    expect(document.querySelector("[data-job-meta]")?.textContent).toBe(`${formatJobDate(DAY)} · 9:00 AM · 123 Main St, Delcambre, LA 70528`);
    expect(screen.queryByText("The street address is shared once you're offered the job.")).toBeNull();
  });

  it("the hired, working Helpr sees the street too", () => {
    state.job = row({ helper_id: ME, status: "in_progress", helper_confirmed_at: "2026-10-20T12:00:00Z" });
    state.party = true;
    renderPage();
    expect(document.querySelector("[data-job-meta]")?.textContent).toContain("123 Main St");
  });

  it("an applicant sees the city only, with the line saying the street comes with an offer", async () => {
    state.job = row();
    state.myApplication = { status: "pending", closed_reason: null };
    renderPage();
    await screen.findByText("You applied · Waiting on Rhonda");
    expect(document.querySelector("[data-job-meta]")?.textContent).toBe(`${formatJobDate(DAY)} · 9:00 AM · Delcambre`);
    expect(screen.getByText("The street address is shared once you're offered the job.")).toBeTruthy();
  });

  it("the poster's page is unchanged (the city in the meta line)", () => {
    state.job = row({ customer_id: ME });
    state.party = true;
    renderPage();
    expect(document.querySelector("[data-job-meta]")?.textContent).toBe(`${formatJobDate(DAY)} · 9:00 AM · Delcambre`);
  });
});

describe("/jobs/:id for a signed-in member", () => {
  it("renders the job page instead of redirecting to /home?quickApply", async () => {
    state.job = row();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/jobs/${row().id}`]}>
          <Routes>
            <Route path="/jobs/:id" element={<JobDetail />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("button", { name: "Apply" })).toBeTruthy();
    expect(screen.queryByTestId("where")).toBeNull();
  });
});

describe("board 57: the poster's open job with no applicants", () => {
  beforeEach(() => { state.party = false; state.applicants = { total: 0, pending: 0 }; state.reach = null; });

  // Board 184: with the reach known and above 0, the page says how many were already told (a floor).
  it("board 184: 'Sent to N Helprs so far.' when the alerts went out; nothing new at 0 or unknown", async () => {
    state.job = row({ customer_id: ME });
    state.reach = 14;
    renderPage();
    expect(await screen.findByText(/^Sent to 14 Helprs so far\. We'll tell you when someone applies\.$/)).toBeTruthy();
  });

  it("board 184: a reach of 0 keeps the plain line (a fresh post has not been sent yet)", async () => {
    state.job = row({ customer_id: ME });
    state.reach = 0;
    renderPage();
    expect(await screen.findByText(/It's out to Helprs near Delcambre\./)).toBeTruthy();
    expect(screen.queryByText(/Sent to/)).toBeNull();
  });

  it("a paid, open job nobody applied to says so, with only what the poster can do", async () => {
    state.job = row({ customer_id: ME });
    renderPage();
    expect(await screen.findByRole("heading", { name: "No applicants yet" })).toBeTruthy();
    expect(screen.getByText(/It's out to Helprs near Delcambre\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add a photo/ })).toBeTruthy();
    const price = screen.getByRole("button", { name: /Change the price/ });
    expect(price.textContent).toContain("You're at $90");
    expect(screen.queryByText(/quotes/i)).toBeNull();
    fireEvent.click(price);
    expect(screen.getByTestId("where").textContent).toContain("manage=1");
  });

  it("an unpaid post, a post with a photo, or one with applicants does not claim it", async () => {
    state.job = row({ customer_id: ME, payment_status: "unpaid" });
    const { unmount } = renderPage();
    expect(await screen.findByText(/Not paid yet/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "No applicants yet" })).toBeNull();
    unmount();
    state.job = row({ customer_id: ME, photos: ["a.jpg"] });
    const r2 = renderPage();
    expect(await screen.findByRole("heading", { name: "No applicants yet" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add a photo/ })).toBeNull();
    r2.unmount();
    state.applicants = { total: 2, pending: 2 };
    state.job = row({ customer_id: ME });
    renderPage();
    expect(await screen.findByText("2 applicants")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "No applicants yet" })).toBeNull();
  });
});
