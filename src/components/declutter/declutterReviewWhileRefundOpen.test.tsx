/**
 * Audit 1028 part 2, D2-15: while a refund request on the order is still being worked out (open, offered),
 * "Leave a review" is the OUTLINE button, so it does not pull the eye from the refund panel above it. Audit BUY-31:
 * while the item is going back, with Louisiana Helpr, or under an open problem it isn't offered at all. Settled,
 * withdrawn or no request: the solid one. NIGHT-SELL-soldstates-7: settled with a full refund, it isn't offered at all. The read is the refund panel's own
 * (same query key), made only when the card shows that panel.
 *
 * @mutate src/components/declutter/DeclutterReviewForm.tsx |   if (problemOpen \|\| refundHoldsTheItem(refund.data?.request?.status) \|\| refundedInFull(refund.data)) return null; |
 * @mutate src/components/declutter/DeclutterReviewForm.tsx | const REFUND_STILL_OPEN: ReadonlySet<string> = new Set(["open", "offered"]); | const REFUND_STILL_OPEN: ReadonlySet<string> = new Set(["open"]);
 * @mutate src/components/declutter/DeclutterReviewForm.tsx | variant={refundStillOpen(refund.data) ? "outline" : "default"} | variant="default"
 * @mutate src/components/declutter/DeclutterReviewForm.tsx |     enabled: refundPanel, |     enabled: true,
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx | userId={userId} refundPanel={!!refundRequests && items > 0} problemOpen={!!problem} /> | userId={userId} problemOpen={!!problem} />
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const state = vi.hoisted(() => ({ status: null as string | null, reads: 0, refundCents: null as number | null }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/UserAvatar", () => ({ default: () => null }));
vi.mock("./useOrderOtherPerson", () => ({ useOrderOtherPerson: () => ({ otherId: "u2", name: "Lexi", avatarUrl: null, who: "Lexi" }) }));
vi.mock("@/lib/declutter/handover", () => ({ leaveReview: vi.fn() }));
vi.mock("@/lib/declutter/refundRequests", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/refundRequests")>()),
  fetchRefundRequestView: async (orderId: string) => {
    state.reads++;
    return { order_id: orderId, side: "buyer", handed_over: true, full_refund_cents: 4084,
      request: state.status ? { id: "r1", status: state.status, refund_cents: state.refundCents } : null };
  },
}));

import { DeclutterReviewForm } from "./DeclutterReviewForm";

const OUTLINE = "border-border/60";

function show(refundPanel: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DeclutterReviewForm orderId="o1" side="buyer" userId="me" refundPanel={refundPanel} />
    </QueryClientProvider>,
  );
  return screen.getByRole("button", { name: "Leave a review" });
}

beforeEach(() => {
  state.status = null;
  state.reads = 0;
  state.refundCents = null;
  localStorage.clear();
});

describe("Leave a review while a refund is open (D2-15)", () => {
  it.each(["returning", "to_admin"])("refund %s: no review is asked for", async (status) => {
    state.status = status;
    const b = show(true);
    await waitFor(() => expect(b.isConnected).toBe(false));
    expect(screen.queryByRole("button", { name: "Leave a review" })).toBeNull();
  });

  it("an open problem: no review is asked for", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <DeclutterReviewForm orderId="o1" side="buyer" userId="me" refundPanel={false} problemOpen />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("button", { name: "Leave a review" })).toBeNull();
  });

  it.each(["open", "offered"])("refund %s: the outline button", async (status) => {
    state.status = status;
    const b = show(true);
    await waitFor(() => expect(b.className).toContain(OUTLINE));
    expect(b.className).not.toContain("btn-grad-primary");
  });

  it.each([null, "agreed", "declined", "withdrawn"])("refund %s: the solid button", async (status) => {
    state.status = status;
    const b = show(true);
    await waitFor(() => expect(state.reads).toBe(1));
    expect(b.className).toContain("btn-grad-primary");
    expect(b.className).not.toContain(OUTLINE);
  });

  // NIGHT-SELL-soldstates-7: a full refund undid the sale; a part refund (an offer taken) did not.
  it.each([[4084, false], [4230, false], [1500, true]])("agreed, %i cents back of 4084 in full: review offered = %s", async (cents, offered) => {
    state.status = "agreed";
    state.refundCents = cents;
    const b = show(true);
    await waitFor(() => expect(state.reads).toBe(1));
    if (offered) {
      await new Promise((r) => setTimeout(r, 20));
      expect(b.isConnected).toBe(true);
    } else {
      await waitFor(() => expect(b.isConnected).toBe(false));
      expect(screen.queryByRole("button", { name: "Leave a review" })).toBeNull();
    }
  });

  it("no refund panel on the card: no refund read at all, the solid button", async () => {
    state.status = "open";
    const b = show(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(state.reads).toBe(0);
    expect(b.className).toContain("btn-grad-primary");
  });

  it("the order card tells the review button whether it shows the refund panel", () => {
    const src = readFileSync(resolve(__dirname, "DeclutterHandoverViews.tsx"), "utf8");
    expect(src).toContain("{refundRequests && items > 0 && (");
    expect(src).toMatch(/<DeclutterReviewForm [^>]*refundPanel=\{!!refundRequests && items > 0\}/);
  });
});
