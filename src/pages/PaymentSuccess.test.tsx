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
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
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
        data: { budget: 120, category: "cleaning", payment_status: "failed" },
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
        data: { budget: 120, category: "cleaning", payment_status: "unpaid" },
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

  describe("the payment IS confirmed held", () => {
    beforeEach(() => {
      jobsLookup = {
        data: { budget: 120, category: "cleaning", payment_status: "escrow" },
        error: null,
      };
    });

    it("renders the success claim and the amount", async () => {
      renderAt();
      const heading = await screen.findByRole("heading", { level: 1 });
      expect(heading).toHaveTextContent(/payment authorized/i);
      expect(screen.getByText("$120")).toBeInTheDocument();
      expect(screen.getByText(/your money stays protected/i)).toBeInTheDocument();
    });

    it("offers the post-payment actions", async () => {
      renderAt();
      await screen.findByRole("heading", { level: 1, name: /payment authorized/i });
      expect(screen.getByRole("button", { name: /view applicants/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^share$/i })).toBeInTheDocument();
    });

    it("accepts payout_pending — the money is still in escrow", async () => {
      jobsLookup = {
        data: { budget: 80, category: "cleaning", payment_status: "payout_pending" },
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
        data: { budget: 80, category: "cleaning", payment_status: "released" },
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
        data: { budget: 80, category: "cleaning", payment_status: "refunded" },
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
