/**
 * ANYONE CAN ACCEPT AN OFFER; PAYOUT SETUP COMES AFTER (Q1399; owner,
 * 2026-10-06, said twice: "you can offer job to anyone, they would set it up
 * after accepting. this is not an exception, it's the rule.").
 *
 * The defect (live prod 2026-10-07, 375, the owner's job as a Helpr with no
 * payout account): the Helpr's offer card drew "Set Up Payouts" with "Set up
 * payouts with Stripe to accept this job..." as its primary and no Accept,
 * because the card read the profile mirror of helper_accept_missing and
 * swapped the accept for the setup.
 *
 * The rule, on the real card wired to the real handlers (useActivityActions):
 *   - before the tap, every Helpr sees "Accept Job" (primary) and "Decline",
 *     whatever their Stripe state, including while the profile is loading;
 *   - tapping Accept calls accept_job_offer (respond_to_direct_offer for a
 *     direct offer), and its pending_setup answer opens AwardGateDialog's
 *     "Thanks for Accepting!" with the setup steps.
 *
 * The profile is read through the REAL useAcceptGate / acceptMissingFromProfile
 * (only useCurrentUser is stubbed), so a gate that comes back through that
 * mirror fails here.
 *
 * @mutate src/components/profile/profileLanding/PayoutStatusRow.tsx | add your payout account so you can get paid. | add your payout account to accept jobs and get paid.
 * @mutate src/lib/awardGate.ts | so this job is fully yours once your payout account is set up | so your payout account has to exist before a job can become yours
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx |       {isExpired ? null : ( |       {isExpired \|\| gate.reason ? null : (
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx |           disabled={busy}\n          aria-busy={busy}\n          data-offer-primary="accept" |           disabled={busy \|\| gate.loading}\n          aria-busy={busy}\n          data-offer-primary="accept"
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";
import { trackedFiles } from "@/test/helpers/trackedFiles";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AppliedApp, Application, Job } from "@/components/job-card/activityConstants";

const { rpcCalls, rpcAnswer, profileState } = vi.hoisted(() => ({
  rpcCalls: [] as { name: string; args: unknown }[],
  rpcAnswer: { current: { data: null as unknown, error: null as unknown } },
  profileState: { profile: null as Record<string, unknown> | null, isLoading: false },
}));

function chain(result: unknown) {
  const self: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "or", "in", "neq", "order", "limit", "maybeSingle", "single", "update", "upsert", "insert"]) {
    self[m] = () => self;
  }
  self.then = (resolve: (v: unknown) => void) => resolve(result);
  return self;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    from: () => chain({ data: null, error: null }),
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return rpcAnswer.current;
    },
  },
}));
vi.mock("@/hooks/useCurrentUser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useCurrentUser")>()),
  useCurrentUser: () => ({ user: { id: "helper-1" }, profile: profileState.profile, isLoading: profileState.isLoading }),
}));
const pendingJobs = new Set<string>();
vi.mock("@/hooks/useAcceptPendingJobs", () => ({ useAcceptPendingJobs: () => pendingJobs }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }) }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn(), hapticMedium: vi.fn(), hapticSuccess: vi.fn(), hapticError: vi.fn(), hapticWarning: vi.fn() }));
vi.mock("@/lib/successMoment", () => ({ fireSuccessMoment: vi.fn() }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: {} }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyJobParty: vi.fn() }));
vi.mock("@/lib/pushPermissionNudge", () => ({ usePushPermissionNudge: () => vi.fn() }));
vi.mock("@/hooks/useStripeConnectCheck", () => ({
  useStripeConnectCheck: () => ({ checkHelperAwardEligibility: async () => ({ ok: false, needsPayoutSetup: true }) }),
}));
vi.mock("@/components/job-card/activityActions/useOptimisticJobCache", () => ({
  useOptimisticJobCache: () => ({ optimisticallyPatchJob: () => undefined, rollbackActivity: vi.fn() }),
}));
vi.mock("@/components/job-card/activityActions/useApplicantsState", () => ({
  useApplicantsState: () => ({
    selectedJob: null, setSelectedJob: vi.fn(),
    applications: [], setApplications: vi.fn(),
    applicationsLoading: false, applicationsError: null,
    inlineApplicants: {}, setInlineApplicants: vi.fn(),
    loadingApplicants: {}, applicantErrors: {},
    loadApplications: vi.fn(), loadInlineApplicants: vi.fn(),
  }),
}));
vi.mock("@/components/job-card/DeadlineCountdown", () => ({ default: () => <div data-testid="answer-clock" /> }));
vi.mock("@/components/job-card/JobCountdown", () => ({ JobCountdown: () => <div data-testid="start-clock" /> }));

import { useActivityActions } from "@/components/job-card/useActivityActions";
import { OfferedActions } from "@/pages/jobs/appliedJobCard/OfferedActions";
import { AwardGateDialog } from "@/components/AwardGateDialog";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const offerJob = {
  id: "job-1",
  title: "Clean my room",
  budget: 80,
  customer_id: "poster-1",
  helper_id: "helper-1",
  date_needed: jobLocalDateISO(1),
  start_time: "13:50:00",
  payment_status: "escrow",
  status: "accepted",
  helper_confirmed_at: null,
  response_deadline: new Date(Date.now() + 3_600_000).toISOString(),
} as unknown as Job;
const appOffer = { id: "app-1", job_id: "job-1", helper_id: "helper-1", status: "accepted", job: offerJob } as unknown as AppliedApp;
const directOffer = { ...appOffer, id: "direct-job-1", is_direct_offer: true } as unknown as AppliedApp;

/** The Activity wiring in miniature: the card's tap goes to the real handler, the pop-up reads its state. */
function OfferCard({ app }: { app: AppliedApp }) {
  const actions = useActivityActions({
    user: { id: "helper-1" } as never,
    postedJobs: [],
    appliedApps: [app],
    refresh: async () => undefined,
    setStatusFilter: vi.fn(),
  });
  return (
    <MemoryRouter>
      <OfferedActions
        app={app}
        job={offerJob}
        onHelperResponse={(a: Application, accept: boolean) => void actions.handleHelperResponse(a, accept)}
        respondingHelperAppId={actions.respondingHelperAppId}
      />
      {actions.awardBlockReason && (
        <AwardGateDialog
          open
          onOpenChange={(o) => { if (!o) actions.closeAwardGate(); }}
          reason={actions.awardBlockReason}
          pendingMissing={actions.acceptPendingMissing}
        />
      )}
    </MemoryRouter>
  );
}

/** Stripe states a Helpr can be in before accepting. Each must still see Accept. */
const STATES: [string, Record<string, unknown> | null, boolean][] = [
  ["no payout account (the owner's 2026-10-07 case)", { user_id: "helper-1", stripe_account_id: null, stripe_payouts_enabled: false }, false],
  ["payout account started, payouts not enabled", { user_id: "helper-1", stripe_account_id: "acct_1", stripe_payouts_enabled: false }, false],
  ["payouts on, Stripe ID not confirmed", { user_id: "helper-1", stripe_account_id: "acct_1", stripe_payouts_enabled: true }, false],
  ["profile still loading", null, true],
  ["fully set up", { user_id: "helper-1", stripe_account_id: "acct_1", stripe_payouts_enabled: true, stripe_identity_verified: true }, false],
];

beforeEach(() => {
  rpcCalls.length = 0;
  pendingJobs.clear();
  rpcAnswer.current = { data: null, error: null };
  profileState.profile = { user_id: "helper-1", stripe_account_id: null, stripe_payouts_enabled: false };
  profileState.isLoading = false;
});

describe("the Helpr's offer card offers Accept to everyone (Q1399, owner 2026-10-06)", () => {
  it("the inventory of Stripe states is the whole set the gate mirror can answer", async () => {
    const { acceptMissingFromProfile } = await import("@/lib/awardGate");
    const answers = new Set(STATES.filter(([, p]) => p).map(([, p]) => acceptMissingFromProfile(p as never).join("+")));
    expect([...answers].sort()).toEqual(["", "payout_setup+stripe_id", "stripe_id"]);
    expect(STATES.length).toBeGreaterThan(3);
  });

  it.each(STATES)("%s: the primary is an enabled Accept Job beside Decline; no setup step before the tap", (_n, profile, loading) => {
    profileState.profile = profile;
    profileState.isLoading = loading;
    render(<OfferCard app={appOffer} />);
    const accept = screen.getByRole("button", { name: /Accept Job/ });
    expect(accept).toBeEnabled();
    expect(accept).toHaveAttribute("data-offer-primary", "accept");
    expect(screen.getByRole("button", { name: /^Decline$/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Set Up Payouts|Finish Stripe Setup|Checking/ })).toBeNull();
    expect(document.querySelector('[data-offer-primary="setup"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/to accept this job|before you can accept/);
  });

  it("no payout account: tapping Accept calls accept_job_offer, and pending_setup opens Thanks for Accepting!", async () => {
    rpcAnswer.current = { data: { state: "pending_setup", missing: ["payout_setup", "stripe_id"] }, error: null };
    render(<OfferCard app={appOffer} />);
    fireEvent.click(screen.getByRole("button", { name: /Accept Job/ }));
    await waitFor(() => expect(rpcCalls.map((c) => c.name)).toContain("accept_job_offer"));
    expect(rpcCalls.find((c) => c.name === "accept_job_offer")?.args).toEqual({ p_job_id: "job-1" });
    expect(await screen.findByText("Thanks for Accepting!")).toBeInTheDocument();
  });

  it("direct offer, no payout account: tapping Accept calls respond_to_direct_offer, and pending_setup opens the same pop-up", async () => {
    rpcAnswer.current = { data: { action: "pending_setup", missing: ["payout_setup"] }, error: null };
    render(<OfferCard app={directOffer} />);
    fireEvent.click(screen.getByRole("button", { name: /Accept Job/ }));
    await waitFor(() => expect(rpcCalls.map((c) => c.name)).toContain("respond_to_direct_offer"));
    expect(rpcCalls.find((c) => c.name === "respond_to_direct_offer")?.args).toEqual({ p_job_id: "job-1", p_accept: true });
    expect(await screen.findByText("Thanks for Accepting!")).toBeInTheDocument();
  });

  it("after the accept, while it waits on Stripe: still Accept (it reopens the pop-up), and the card says it is not accepted yet", async () => {
    pendingJobs.add("job-1");
    rpcAnswer.current = { data: { state: "pending_setup", missing: ["payout_setup", "stripe_id"] }, error: null };
    render(<OfferCard app={appOffer} />);
    expect(document.querySelector("[data-offer-pending-status]")?.textContent).toMatch(/Not accepted yet: waiting on your payout setup and Stripe ID check/);
    fireEvent.click(screen.getByRole("button", { name: /Accept Job/ }));
    await waitFor(() => expect(rpcCalls.map((c) => c.name)).toContain("accept_job_offer"));
    expect(await screen.findByText(/You're not booked yet/)).toBeInTheDocument();
  });
});

/**
 * Spec 12 (owner, 2026-10-07, /profile on the owner's iPhone): no copy in the
 * app may say payout setup or a Stripe ID is needed to ACCEPT or TAKE a job.
 * The class, over every non-test source file: the phrasings that shipped
 * ("to accept jobs and get paid", "before a job can become yours", "before you
 * can accept", "can't accept an offer yet", "to Take This Job"). Comments are
 * blanked, so only rendered strings count.
 */
describe("no copy says payouts or ID gate the accept (Q1399 spec 12)", () => {
  const BANNED = [
    /to accept jobs and get paid/i,
    /before a job can become yours/i,
    /before you can accept/i,
    /can't accept an offer yet/i,
    /to Take This Job/i,
    /to accept this job/i,
  ];
  const files = trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.|\/test\//.test(f));

  it("the inventory is the app's source", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("none of the banned phrasings is in any rendered string", () => {
    const hits = files.flatMap((f) => {
      const code = blankComments(readFileSync(f, "utf8"));
      return BANNED.filter((re) => re.test(code)).map((re) => `${f}: ${re}`);
    });
    expect(hits).toEqual([]);
  });
});
