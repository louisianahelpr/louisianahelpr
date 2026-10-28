/**
 * Order and money reads are read again on every open, and say "Updating…" while they do (Declutter deep audit #17 /
 * SH-5, 2026-10-28, shots 49b-seller-after-handover-wait-390, 58 vs 58b-buyer-refund-offer, 76-buyer-after-pay): the
 * device's saved cache showed an order's old state for 6 to 20 s after reopening, with no cue.
 *
 * Inventory: every ORDER_QUERY_HEADS entry is a real ["declutter", <head>] read in src/components (a renamed key
 * would silently fall back to the 60 s default), floor 10.
 *
 * @mutate src/lib/declutter/orderFreshness.ts |     qc.setQueryDefaults(["declutter", head], { staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: "always" }); |     qc.setQueryDefaults(["declutter", head], { staleTime: 0 });
 * @mutate src/lib/queryClient.ts | keepOrderReadsFresh(queryClient);\n |
 * @mutate src/components/declutter/OrdersUpdating.tsx |   const fetching = useIsFetching({ predicate: (q) => isOrderQueryKey(q.queryKey) && q.state.data !== undefined }); |   const fetching = useIsFetching({ predicate: (q) => isOrderQueryKey(q.queryKey) });
 * @mutate src/components/declutter/DeclutterHomeView.tsx |       {(view === "buying" \|\| view === "selling") && <OrdersUpdating />}\n |
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { ORDER_QUERY_HEADS, keepOrderReadsFresh } from "@/lib/declutter/orderFreshness";
import { OrdersUpdating } from "@/components/declutter/OrdersUpdating";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");

function Cart({ fetch }: { fetch: () => Promise<string[]> }) {
  const q = useQuery({ queryKey: ["declutter", "my-cart"], queryFn: fetch });
  return <p>{q.data?.join(",") ?? "loading"}</p>;
}

/** The app's own defaults (60 s fresh), plus the order rule, with a cart read already on the device. */
function clientWithSavedCart(saved: string[] | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000, refetchOnWindowFocus: true } } });
  keepOrderReadsFresh(qc);
  if (saved) qc.setQueryData(["declutter", "my-cart"], saved);
  return qc;
}

afterEach(() => vi.useRealTimers());

describe("order and money reads stay fresh (deep audit #17)", () => {
  it("the app's query client reads every order key again on mount and focus; other keys keep the 60 s default", () => {
    for (const head of ORDER_QUERY_HEADS) {
      const d = queryClient.getQueryDefaults(["declutter", head, "x"]);
      expect(d, head).toMatchObject({ staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: "always" });
    }
    expect(queryClient.getQueryDefaults(["declutter", "watching"]).refetchOnMount).toBeUndefined();
  });

  it("every order key is a real read in src/components", () => {
    const files = walkSource([join(ROOT, "src/components")]).filter((f) => f.endsWith(".tsx") && !/\.test\./.test(f));
    const src = files.map((f) => blankComments(readFileSync(f, "utf8"))).join("\n");
    expect(ORDER_QUERY_HEADS.length).toBeGreaterThanOrEqual(10);
    for (const head of ORDER_QUERY_HEADS) expect(src, head).toContain(`queryKey: ["declutter", "${head}"`);
  });

  it("a cart saved seconds ago is still read again when the screen opens", async () => {
    const qc = clientWithSavedCart(["old"]);
    const fetch = vi.fn(async () => ["new"]);
    render(<QueryClientProvider client={qc}><Cart fetch={fetch} /></QueryClientProvider>);
    expect(screen.getByText("old")).toBeInTheDocument();
    expect(await screen.findByText("new")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("over data already shown, a slow read says Updating… (after a short wait), and stops when it lands", async () => {
    vi.useFakeTimers();
    const qc = clientWithSavedCart(["old"]);
    let land: (v: string[]) => void = () => {};
    const fetch = () => new Promise<string[]>((r) => { land = r; });
    render(<QueryClientProvider client={qc}><Cart fetch={fetch} /><OrdersUpdating /></QueryClientProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.queryByText("Updating…")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.getByRole("status")).toHaveTextContent("Updating…");
    await act(async () => { land(["new"]); await vi.advanceTimersByTimeAsync(10); });
    expect(screen.getByText("new")).toBeInTheDocument();
    expect(screen.queryByText("Updating…")).toBeNull();
  });

  it("a first load (nothing on screen yet) shows no Updating… cue", async () => {
    vi.useFakeTimers();
    const qc = clientWithSavedCart(null);
    render(<QueryClientProvider client={qc}><Cart fetch={() => new Promise<string[]>(() => {})} /><OrdersUpdating /></QueryClientProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.queryByText("Updating…")).toBeNull();
  });

  it("Buying and Selling mount the cue", () => {
    const home = blankComments(readFileSync(join(ROOT, "src/components/declutter/DeclutterHomeView.tsx"), "utf8"));
    expect(home).toMatch(/\{\(view === "buying" \|\| view === "selling"\) && <OrdersUpdating \/>\}/);
  });
});
