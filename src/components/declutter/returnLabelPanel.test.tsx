/**
 * The buyer's return label (20261103212046). The buyer's notice says "Print it from your order"; before this no
 * screen called declutter_my_return_label, so the label could not be printed anywhere.
 *   - bought: "Send the item back", the return tracking number and "Print return label" (opens the label file);
 *   - requested: the label is being made; failed: Louisiana Helpr will message about the return;
 *   - no return asked for (the server's order_not_found, the normal case): nothing at all, never an error;
 *   - any other error says so with a retry; the switch off: no call at all.
 *   - The buyer's card of a shipped order mounts it (handed over or refunded), outside the folded body.
 *
 * @mutate src/lib/declutter/returnLabel.ts |   if (res.error && (await rpcErrorCode("declutter_my_return_label", res.error)) === "order_not_found") return null; |
 * @mutate src/components/declutter/ReturnLabelPanel.tsx | onClick={() => void openExternalUrl(url)} | onClick={() => undefined}
 * @mutate src/components/declutter/ReturnLabelPanel.tsx |   if (r.state === "failed" \|\| !r.label_url) { |   if (r.state === "failed") {
 * @mutate src/components/declutter/ReturnLabelPanel.tsx | enabled: on }); | enabled: true });
 * @mutate src/components/declutter/ReturnLabelPanel.tsx |   if (q.isError) { |   if (false) {
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |       {order.side === "buyer" && order.handover === "ship" && (order.status === "handed_over" \|\| order.status === "refunded") && ( |       {order.side === "buyer" && order.handover === "ship" && order.status === "handed_over" && (
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const state = {
  on: true,
  answer: { data: null, error: null } as { data: unknown; error: unknown },
  rpc: [] as [string, unknown][],
  opened: [] as string[],
};
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => state.on }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async (fn: string, args: unknown) => { state.rpc.push([fn, args]); return state.answer; } },
}));
vi.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: async (u: string) => { state.opened.push(u); } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { ReturnLabelPanel } from "./ReturnLabelPanel";

const ORDER = "aaaaaaaa-0000-4000-8000-0000000000aa";
const renderIt = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ReturnLabelPanel orderId={ORDER} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.on = true;
  state.answer = { data: null, error: null };
  state.rpc = [];
  state.opened = [];
});

describe("ReturnLabelPanel", () => {
  it("a bought label shows the return tracking and prints the label", async () => {
    state.answer = { data: { state: "bought", label_url: "https://easypost-files.s3.amazonaws.com/label.pdf", tracking_code: "9400111" }, error: null };
    renderIt();
    expect(await screen.findByText("Send the item back")).toBeTruthy();
    expect(screen.getByText("9400111")).toBeTruthy();
    expect(state.rpc).toEqual([["declutter_my_return_label", { p_order_id: ORDER }]]);
    fireEvent.click(screen.getByRole("button", { name: "Print return label" }));
    await waitFor(() => expect(state.opened).toEqual(["https://easypost-files.s3.amazonaws.com/label.pdf"]));
  });

  it("a requested label says it is being made, with nothing to print", async () => {
    state.answer = { data: { state: "requested", label_url: null, tracking_code: null }, error: null };
    renderIt();
    expect(await screen.findByText(/Your return label is being made/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Print return label" })).toBeNull();
  });

  it("a failed label (or a bought one with no file) says Louisiana Helpr will message, with nothing to print", async () => {
    state.answer = { data: { state: "bought", label_url: null, tracking_code: null }, error: null };
    renderIt();
    expect(await screen.findByText(/We couldn't make your return label/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Print return label" })).toBeNull();
  });

  it("no return asked for (order_not_found) shows nothing, never an error", async () => {
    state.answer = { data: null, error: { code: "PT404", message: "order_not_found" } };
    const { container } = renderIt();
    await waitFor(() => expect(state.rpc).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe("");
  });

  it("any other error says so", async () => {
    state.answer = { data: null, error: { code: "XX000", message: "boom" } };
    renderIt();
    expect(await screen.findByText("We couldn't load your return label.")).toBeTruthy();
  });

  it("the switch off: no call, nothing shown", async () => {
    state.on = false;
    const { container } = renderIt();
    await new Promise((r) => setTimeout(r, 20));
    expect(state.rpc).toEqual([]);
    expect(container.textContent).toBe("");
  });

  it("the buyer's shipped order card mounts it when handed over or refunded, outside the folded body", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "DeclutterHandoverViews.tsx"), "utf8"));
    const mount = src.indexOf("<ReturnLabelPanel orderId={order.orderId} />");
    expect(mount).toBeGreaterThan(0);
    const guard = src.slice(src.lastIndexOf("{order.side", mount), mount);
    expect(guard).toContain('order.side === "buyer" && order.handover === "ship" && (order.status === "handed_over" || order.status === "refunded")');
    // Before the folded body opens ({body && <div ...data-order-body>).
    expect(mount).toBeLessThan(src.indexOf("data-order-body"));
  });
});
