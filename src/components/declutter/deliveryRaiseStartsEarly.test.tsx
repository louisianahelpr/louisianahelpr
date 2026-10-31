/**
 * "Raise the pay" starts loading with the delivery, not after it (audit 2 A2-7 / B2-3, 2026-10-28,
 * a2-31-buyer-raise-*-390): the panel and the Helpr order card took more than 10 s to appear on Buying; the first
 * try found no panel at 10 s. The raise read only began once the task read had landed and the panel mounted, so the
 * two waits added up. The delivery card now starts both at once (the same query, so the panel reads the cache).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({ raiseReads: [] as string[] }));

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: undefined }) }));
vi.mock("@/lib/helprTasks/api", () => ({
  // The task read never lands: only a read started beside it can have begun.
  fetchTaskView: () => new Promise(() => {}),
  confirmReceived: vi.fn(),
  taskPhotoUrl: vi.fn(),
}));
vi.mock("@/lib/declutter/deliveryRaise", () => ({
  fetchDeliveryRaiseStatus: async (orderId: string) => {
    state.raiseReads.push(orderId);
    return null;
  },
  startDeliveryRaise: vi.fn(),
}));
vi.mock("@/lib/declutter/deliveryTip", () => ({ fetchMyPaidDeliveryTips: async () => [], fetchTipsOnMyDeliveries: async () => new Map(), startDeliveryTip: vi.fn() }));

import { OrderDeliveryPanel } from "./DeclutterDeliveryViews";

function show(side: "buyer" | "seller") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><OrderDeliveryPanel taskId="t1" side={side} orderId="o1" /></QueryClientProvider>);
}

beforeEach(() => {
  state.raiseReads = [];
});

describe("the raise read starts with the delivery card (A2-7)", () => {
  // @mutate src/components/declutter/DeclutterDeliveryViews.tsx |   useQuery({ ...deliveryRaiseQuery(orderId), enabled: side === "buyer" });\n |
  it("buyer: the raise read is already out while the task read is still loading", async () => {
    const { getByText } = show("buyer");
    expect(getByText("Loading the delivery…")).toBeInTheDocument();
    await vi.waitFor(() => expect(state.raiseReads).toEqual(["o1"]));
  });

  it("seller: no raise read (only the buyer can raise the pay)", async () => {
    show("seller");
    await new Promise((r) => setTimeout(r, 30));
    expect(state.raiseReads).toEqual([]);
  });
});
