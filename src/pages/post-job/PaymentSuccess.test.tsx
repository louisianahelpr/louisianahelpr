/**
 * PaymentSuccess — the screen is only allowed to claim the money is held when
 * it has CONFIRMED that from a successful read.
 *
 * This file exists because the page used to be a static "Payment authorized.
 * Held securely…" card: it asserted the outcome purely because the router had
 * landed here, so every request behind it could 500 and the copy would not
 * change by a single word. Telling someone their money is secured when we have
 * no idea whether it is, is the most damaging bug this app can ship — so the
 * "failed confirmation must NOT render a success claim" behaviour is pinned
 * here permanently rather than left to a sweep that only runs on demand.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PaymentSuccess from "./PaymentSuccess";

const JOB_ID = "10000000-0000-4000-8000-000000000001";
/** The signed-in account, and by default the job's poster. */
const POSTER = "20000000-0000-4000-8000-000000000002";
/** Another account that can read the job (an admin reads every job). */
const OTHER = "30000000-0000-4000-8000-000000000003";
let viewerId: string | null = POSTER;

/** What the `jobs` confirmation lookup will answer with. */
let jobsLookup: { data: unknown; error: unknown } = { data: null, error: null };

const maybeSingle = vi.fn(async () => jobsLookup);
const getUser = vi.fn(async () => ({ data: { user: null } }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: () => getUser(),
      // AuthShell renders the shared Navbar on web, which reads useAuthReady.
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: () =>
        Promise.resolve({ data: { session: viewerId ? { user: { id: viewerId } } : null }, error: null }),
    },
    from: () => ({
      // The confirmation lookup: .select(...).eq(...).maybeSingle()
      // The analytics count query: .select(..., {count}).eq(...).not(...)
      select: () => {
        const chain = {
          eq: () => chain,
          not: () => Promise.resolve({ count: 1, error: null }),
          maybeSingle: () => maybeSingle(),
        };
        return chain;
      },
    }),
  },
}));

vi.mock("@/lib/haptics", () => ({
  hapticSuccess: vi.fn(),
  hapticLight: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({
  track: vi.fn(),
  AhaEvent: { PaymentMade: "payment_made", FirstPaymentCollected: "first_payment_collected" },
}));

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

const renderAt = (search = `?job_id=${JOB_ID}`) =>
  render(
    <MemoryRouter initialEntries={[`/payment-success${search}`]}>
      <PaymentSuccess />
    </MemoryRouter>,
  );

/** Every phrasing on this screen that asserts the money is safely held. */
const SUCCESS_CLAIMS = [/payment authorized/i, /held securely/i, /is held securely/i];

function expectNoSuccessClaim() {
  for (const claim of SUCCESS_CLAIMS) {
    expect(screen.queryByText(claim)).toBeNull();
  }
  // The escrow promise panel is part of the same claim.
  expect(screen.queryByText(/your money stays protected/i)).toBeNull();
}

describe("PaymentSuccess", () => {
  beforeEach(() => {
    maybeSingle.mockClear();
    getUser.mockClear();
    navigateMock.mockReset();
    jobsLookup = { data: null, error: null };
    viewerId = POSTER;
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("the confirmation read FAILED", () => {
    beforeEach(() => {
      jobsLookup = {
        data: null,
        error: { code: "XX000", message: "simulated query failure", details: null, hint: null },
      };
    });

    it("does NOT claim the payment was authorized or is held", async () => {
      renderAt();
      await screen.findByText(/we couldn't confirm your payment/i);
      expectNoSuccessClaim();
    });

    it("says plainly that it could not confirm, without claiming money was or wasn't taken", async () => {
      renderAt();
      const heading = await screen.findByRole("heading", { level: 1 });
      expect(heading).toHaveTextContent(/couldn't confirm your payment/i);
      // Honest about uncertainty in BOTH directions.
      expect(screen.getByText(/can't tell you either way/i)).toBeInTheDocument();
      expect(screen.getByText(/does not mean it failed/i)).toBeInTheDocument();
    });

    it("tells the user what to do next and gives a way out", async () => {
      renderAt();
      await screen.findByText(/we couldn't confirm your payment/i);
      expect(screen.getByRole("button", { name: /open my posts/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /contact support/i })).toBeInTheDocument();
      expect(screen.getByText(/don't pay again/i)).toBeInTheDocument();
    });

    it("does not offer Share / Post another for a job it can't confirm is funded", async () => {
      renderAt();
      await screen.findByText(/we couldn't confirm your payment/i);
      expect(screen.queryByRole("button", { name: /^share$/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /post another/i })).toBeNull();
    });
  });

  describe("the row says the payment never landed", () => {
    it("does not render a success claim for payment_status 'failed'", async () => {
      jobsLookup = {
        data: { budget: 120, category: "cleaning", payment_status: "failed", customer_id: POSTER },
        error: null,
      };
      renderAt();
      await screen.findByText(/your payment didn't go through/i);
      expectNoSuccessClaim();
      // …and never quotes an amount as held, even though budget read fine.
      expect(screen.queryByText(/\$120/)).toBeNull();
    });
  });

  describe("the webhook hasn't landed yet ('unpaid')", () => {
    it("ends on 'couldn't confirm', never on a success claim", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      jobsLookup = {
        data: { budget: 120, category: "cleaning", payment_status: "unpaid", customer_id: POSTER },
        error: null,
      };
      renderAt();
      // Poll window is 4 attempts × 1.5s.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8_000);
      });
      await waitFor(() => {
        expect(screen.getByText(/we couldn't confirm your payment/i)).toBeInTheDocument();
      });
      expectNoSuccessClaim();
      expect(screen.getByText(/hasn't been confirmed on our side yet/i)).toBeInTheDocument();
    });
  });

  describe("no job reference at all", () => {
    it("admits it cannot confirm rather than defaulting to success", async () => {
      renderAt("");
      await screen.findByText(/we couldn't confirm your payment/i);
      expectNoSuccessClaim();
      expect(screen.getByText(/don't have a reference for this payment/i)).toBeInTheDocument();
      // Nothing to re-check, so no dead Try again button.
      expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
      expect(screen.getByRole("button", { name: /open my posts/i })).toBeInTheDocument();
    });
  });

  describe("a malformed job_id (Q305)", () => {
    it("never reaches Postgres and lands on the no-reference state", async () => {
      renderAt("?job_id=e2e-stub");
      await screen.findByText(/we couldn't confirm your payment/i);
      expectNoSuccessClaim();
      expect(screen.getByText(/don't have a reference for this payment/i)).toBeInTheDocument();
      expect(maybeSingle).not.toHaveBeenCalled();
    });
  });

  // OWNER BUG, 2026-10-05: signed in to their admin account, the owner opened
  // /payment-success?job_id=X for a job their OTHER account had paid for and
  // was told "Payment authorized — $10 is held securely", with View Applicants.
  // The page read the job by id alone. Only the job's poster gets the claim;
  // never role-gated, so an admin is just another account here.
  describe("the job belongs to a different account", () => {
    beforeEach(() => {
      viewerId = OTHER;
      jobsLookup = {
        data: { budget: 10, category: "cleaning", payment_status: "escrow", customer_id: POSTER },
        error: null,
      };
    });

    it("makes no payment claim, quotes no amount and offers no poster actions", async () => {
      renderAt();
      const heading = await screen.findByRole("heading", { level: 1, name: /belongs to a different account/i });
      expect(heading).toBeInTheDocument();
      expectNoSuccessClaim();
      expect(screen.queryByText(/\$10/)).toBeNull();
      expect(screen.queryByRole("button", { name: /view applicants/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /^share$/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /post another/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /open my posts/i })).toBeNull();
      // …and a way back.
      expect(screen.getByRole("button", { name: /back to dashboard/i })).toBeInTheDocument();
    });

    it("treats a job with no poster left (anonymised) as not the viewer's", async () => {
      viewerId = POSTER;
      jobsLookup = {
        data: { budget: 10, category: "cleaning", payment_status: "escrow", customer_id: null },
        error: null,
      };
      renderAt();
      await screen.findByRole("heading", { level: 1, name: /belongs to a different account/i });
      expectNoSuccessClaim();
    });

    it("the poster still gets the claim for the same row", async () => {
      viewerId = POSTER;
      renderAt();
      await screen.findByRole("heading", { level: 1, name: /payment authorized/i });
      expect(screen.getByText("$10")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /view applicants/i })).toBeInTheDocument();
    });
  });

  describe("the payment IS confirmed held", () => {
    beforeEach(() => {
      jobsLookup = {
        data: { budget: 120, category: "cleaning", payment_status: "escrow", customer_id: POSTER },
        error: null,
      };
    });

    it("renders the success claim and the amount", async () => {
      renderAt();
      const heading = await screen.findByRole("heading", { level: 1 });
      expect(heading).toHaveTextContent(/payment authorized/i);
      expect(screen.getByText("$120")).toBeInTheDocument();
    });

    // Owner, 2026-10-05: nothing on this screen says the same thing twice. The
    // wordmark's "PAYMENT AUTHORIZED" eyebrow repeated the h1, and a shield box
    // repeated the "held securely until you confirm" line and the Released step.
    it("says each thing once", async () => {
      renderAt();
      await screen.findByRole("heading", { level: 1, name: /payment authorized/i });
      expect(screen.getAllByText(/payment authorized/i)).toHaveLength(1);
      expect(screen.queryByText(/your money stays protected/i)).toBeNull();
      expect(screen.getAllByText(/held securely/i)).toHaveLength(1);
    });
// @mutate src/pages/post-job/PaymentSuccess.tsx | <AuthShell hideBack hideHeader centerColumn | <AuthShell hideBack centerColumn eyebrow="Payment authorized"

    it("offers the post-payment actions", async () => {
      renderAt();
      await screen.findByRole("heading", { level: 1, name: /payment authorized/i });
      expect(screen.getByRole("button", { name: /view applicants/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^share$/i })).toBeInTheDocument();
    });

    it("accepts payout_pending — the money is still in escrow", async () => {
      jobsLookup = {
        data: { budget: 80, category: "cleaning", payment_status: "payout_pending", customer_id: POSTER },
        error: null,
      };
      renderAt();
      await screen.findByRole("heading", { level: 1, name: /payment authorized/i });
    });

    it("claims success for an ALREADY-RELEASED job, but with corrected copy (not the escrow sentence)", async () => {
      // ME-041 (lh-money-escrow, 2026-09-04): `released` used to match
      // neither HELD_STATUSES nor NOT_HELD_STATUSES, so re-opening this
      // return URL for a job whose payout had already completed fell
      // through every poll attempt and landed on "we couldn't confirm your
      // payment… please don't pay again" — actively wrong for a payment
      // that had not only succeeded but had already been paid out. The
      // fix is to still claim success (the money really was collected and
      // released), just never say the escrow-specific "released when you
      // confirm the work is done" sentence, which IS false once released.
      jobsLookup = {
        data: { budget: 80, category: "cleaning", payment_status: "released", customer_id: POSTER },
        error: null,
      };
      renderAt();
      const heading = await screen.findByRole("heading", { level: 1 });
      expect(heading).toHaveTextContent(/payment authorized/i);
      expect(screen.getByText(/already been released/i)).toBeInTheDocument();
      expect(screen.queryByText(/released when you confirm the work is done/i)).not.toBeInTheDocument();
    });

    it("does NOT claim success for 'refunded' — genuinely ambiguous, unlike 'released'", async () => {
      // A refund means money was taken and then returned — "was this
      // payment confirmed" is a real unresolved question, not the same
      // shape as `released` (taken and definitely kept). Declining to
      // claim success here is still the right call.
      vi.useFakeTimers({ shouldAdvanceTime: true });
      jobsLookup = {
        data: { budget: 80, category: "cleaning", payment_status: "refunded", customer_id: POSTER },
        error: null,
      };
      const view = renderAt();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8_000);
      });
      await waitFor(() => {
        expect(screen.getByText(/we couldn't confirm your payment/i)).toBeInTheDocument();
      });
      expectNoSuccessClaim();
      view.unmount();
    });
  });
});

// Proof this guard can fail: the screen may claim the money is held ONLY for a
// status that proves it is. Widening the held set to the two states that mean
// "we do not know" (unpaid: webhook not landed) and "taken then given back"
// (refunded) makes the page print "Payment authorized / held securely" over
// both — the exact claim this file exists to forbid.
// @mutate src/pages/post-job/PaymentSuccess.tsx | const HELD_STATUSES = new Set(["escrow", "payout_pending", "released"]); | const HELD_STATUSES = new Set(["escrow", "payout_pending", "released", "unpaid", "refunded"]);
