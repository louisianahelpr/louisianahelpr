/**
 * Porch weekday chips (owner 2026-10-29, builder 23's leftover; migration 20261029161347, proof
 * src/test/pglite/declutterPorchWeekdays.pglite.mjs). Shown on step 4 while "Porch pickup" is ticked;
 * each tap saves the seller's days; none picked says the pickup-time days apply; hidden before the
 * migration is on the server.
 *
 * @mutate src/components/declutter/SellHandoverChoices.tsx |       {(free \|\| ways.includes("porch")) && <SellPorchDays />} |
 * @mutate src/components/declutter/SellPorchDays.tsx | picked.includes(d) ? picked.filter((x) => x !== d) : [...picked, d].sort((a, b) => a - b) | [d]
 * @mutate src/components/declutter/SellPorchDays.tsx |   if (mine.data === PORCH_DAYS_NOT_DEPLOYED \|\| mine.isLoading) return null; |   if (mine.isLoading) return null;
 * @mutate src/lib/declutter/porchDays.ts |   if (r.error && isMissingRpcNamed(r.error, "declutter_my_porch_days")) return PORCH_DAYS_NOT_DEPLOYED; |
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: h.rpc } }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));

import { SellHandoverChoices } from "./SellHandoverChoices";

function open(ways: ("porch" | "meetup")[] = ["porch"]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SellHandoverChoices ways={ways} setWays={() => {}} free={false} sellerDeliveryOpen={false} />
    </QueryClientProvider>,
  );
}

describe("porch weekday chips", () => {
  let stored: number[] | null;
  beforeEach(() => {
    stored = [3];
    h.rpc.mockReset();
    h.rpc.mockImplementation(async (fn: string, args?: { p_weekdays: number[] }) => {
      if (fn === "declutter_my_porch_days") return { data: stored, error: null };
      if (fn === "declutter_set_porch_days") { stored = args!.p_weekdays.length ? args!.p_weekdays : null; return { data: args!.p_weekdays, error: null }; }
      return { data: null, error: { message: "unexpected" } };
    });
  });

  it("shows the seller's days while porch pickup is ticked, and each tap saves", async () => {
    open();
    expect(await screen.findByRole("button", { name: "Wednesday" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Sunday" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Sunday" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("declutter_set_porch_days", { p_weekdays: [0, 3] }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Sunday" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByText("Buyers pick one of these days. They apply to all your listings.")).toBeInTheDocument();
  });

  it("none picked says the pickup-time days apply", async () => {
    stored = null;
    open();
    expect(await screen.findByText("None picked: buyers pick one of your pickup-time days.")).toBeInTheDocument();
  });

  it("not shown without porch pickup, nor before the server has it", async () => {
    open(["meetup"]);
    expect(document.querySelector("[data-porch-days]")).toBeNull();
    h.rpc.mockImplementation(async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.declutter_my_porch_days without parameters in the schema cache" } }));
    const { container } = open();
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("declutter_my_porch_days"));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("[data-porch-days]")).toBeNull();
    expect(container.querySelector("[role=alert]")).toBeNull();
  });
});
