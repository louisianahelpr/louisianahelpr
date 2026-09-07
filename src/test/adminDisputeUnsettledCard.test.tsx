/**
 * The dispute card in the state prod was actually in.
 *
 * The Decided tab rendered a green DECIDED badge over dispute c7a12050 while
 * $180 of a poster's escrow had not moved, with no ids, no reason and no way
 * to retry anywhere on the screen. This test renders that exact row and asserts
 * the card now says so — and that the split panel's presets and figures are the
 * ones an admin can act on.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DisputeCard } from "@/components/admin/adminDisputes/DisputeCard";
import type { DisputedJob, DisputeRecord } from "@/components/admin/adminDisputes/types";

const JOB_ID = "bb2c3732-476a-4f66-aae6-372cbdfcfdf6";
const DISPUTE_ID = "c7a12050-1542-40f0-99b6-189c47a13bd8";

const job: DisputedJob = {
  id: JOB_ID,
  title: "Lockbox code was wrong",
  budget: 180,
  status: "completed",
  dispute_reason: "Helpr never got inside",
  dispute_evidence_urls: [],
  disputed_at: "2026-09-05T10:00:00Z",
  disputed_by: "poster-1",
  customer_id: "poster-1",
  helper_id: "helper-1",
  // The prod row: escrow set with no PaymentIntent, which is why the split
  // was correctly refused — and then silently forgotten.
  stripe_payment_intent_id: null,
  urgent_fee: 0,
  helper_fee_percent: 12,
  customer_fee_amount: 5,
  sales_tax_amount: 0,
  payment_status: "escrow",
};

const record: DisputeRecord = {
  id: DISPUTE_ID,
  job_id: JOB_ID,
  opener_id: "poster-1",
  reason: "Helpr never got inside",
  evidence_urls: [],
  status: "decided",
  created_at: "2026-09-05T10:00:00Z",
  decided_at: "2026-09-07T06:44:54Z",
  decided_by: "admin-1",
  decision_text: "Split evenly.",
  payout_split: { poster: 0.5, helper: 0.5 },
  execution_status: "pending",
  executed_at: null,
  execution_transfer_id: null,
  execution_refund_id: null,
  execution_helper_cents: null,
  execution_refund_cents: null,
  execution_error: null,
};

const renderCard = (over: Partial<React.ComponentProps<typeof DisputeCard>> = {}) => {
  const props = {
    job,
    filter: "open" as const,
    disputeRecords: { [JOB_ID]: record },
    profiles: { "poster-1": "Perry", "helper-1": "Hallie" },
    tiers: { "helper-1": "free" },
    activePanelJobId: null as string | null,
    resolving: null,
    decisionText: "",
    helperShare: 50,
    submittingDecision: false,
    openDecisionPanel: vi.fn(),
    setConfirm: vi.fn(),
    setDecisionText: vi.fn(),
    setHelperShare: vi.fn(),
    setActivePanelJobId: vi.fn(),
    decide: vi.fn(),
    retrySettlement: vi.fn(),
    retrying: null as string | null,
    ...over,
  };
  const { container } = render(<DisputeCard {...props} />);
  // The money figures are assembled from several JSX expressions, so they land
  // as separate text nodes and `getByText` cannot see them whole. What an admin
  // reads is the rendered STRING, so assert against that.
  return { ...props, text: () => (container.textContent ?? "").replace(/\s+/g, " ") };
};

describe("a decided dispute whose money never moved", () => {
  it("is marked UNSETTLED, not DECIDED", () => {
    renderCard();
    expect(screen.getByText(/unsettled/i)).toBeInTheDocument();
    // The badge that told an admin this case was closed must not be there.
    expect(screen.queryByText(/^Settled$/)).not.toBeInTheDocument();
  });

  it("says in words that nobody has been paid or refunded", () => {
    renderCard();
    expect(screen.getByText(/escrow has NOT moved/i)).toBeInTheDocument();
    expect(screen.getByText(/Nobody has been paid or refunded/i)).toBeInTheDocument();
  });

  it("shows the ids an admin needs to reconcile, including the missing PaymentIntent", () => {
    renderCard();
    const ids = screen.getByText(new RegExp(DISPUTE_ID));
    expect(ids).toHaveTextContent(JOB_ID);
    expect(ids).toHaveTextContent(/no PaymentIntent on file/i);
  });

  it("offers a retry, and calls it with this job", () => {
    const props = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /retry settlement/i }));
    expect(props.retrySettlement).toHaveBeenCalledWith(job);
  });

  it("surfaces the executor's own recorded reason once it has failed", () => {
    renderCard({
      disputeRecords: {
        [JOB_ID]: {
          ...record,
          execution_status: "failed",
          execution_error: "no payment intent on file — cannot verify or split the escrow",
        },
      },
    });
    expect(screen.getByText(/no payment intent on file/i)).toBeInTheDocument();
  });

  it("reads as Settled — with no retry — once the money HAS moved", () => {
    renderCard({
      disputeRecords: {
        [JOB_ID]: {
          ...record,
          execution_status: "executed",
          executed_at: "2026-09-07T07:00:00Z",
          execution_helper_cents: 7920,
          execution_refund_cents: 8660,
        },
      },
    });
    expect(screen.queryByText(/unsettled/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry settlement/i })).not.toBeInTheDocument();
    expect(screen.getByText(/79\.20/)).toBeInTheDocument();
  });
});

describe("the split panel an admin decides in", () => {
  const openPanel = (helperShare = 50) =>
    renderCard({ activePanelJobId: JOB_ID, decisionText: "x", helperShare });

  it("labels the presets for the side the number belongs to", () => {
    // They were inverted: "Resolve for Poster (0/100)" set the poster to 100%,
    // against a readout directly above it that reads Poster · Helpr.
    openPanel();
    expect(screen.getByRole("button", { name: /Resolve for Poster \(100% poster\)/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Resolve for Helpr \(100% Helpr\)/i })).toBeInTheDocument();
  });

  it("shows what each side NETS, not just the gross percentage", () => {
    // $180 budget, 12% commission, $5 service fee. A 50/50 pays the Helpr
    // $79.20, not $90 — and refunds the poster $89.67, not $90.
    const { text } = openPanel(50);
    // The two columns read: percent, net, verb, gross, deduction.
    expect(text()).toMatch(/Poster 50%\$89\.67refunded\$90 gross−\$2\.84 Stripe keeps/);
    expect(text()).toMatch(/Helpr 50%\$79\.20paid\$90 gross−\$10\.80 commission \(12%\)/);
    // Gross is still shown beside net, so the two are visibly different
    // numbers. `formatPriceExact` drops a zero cent part by design, so a round
    // $90 is "$90" — the rule every other money surface here follows.
    expect(text().match(/\$90 gross/g)).toHaveLength(2);
  });

  it("itemises what is being withheld from each side", () => {
    const { text } = openPanel(50);
    expect(text()).toContain("−$10.80 commission (12%)");
    expect(text()).toMatch(/−\$[\d.]+ Stripe keeps/);
  });

  it("moves the net figures with the slider", () => {
    const { text } = openPanel(100);
    expect(text()).toMatch(/Helpr 100%\$158\.40paid/);
    expect(text()).toMatch(/Poster 0%\$0refunded/);
  });
});
