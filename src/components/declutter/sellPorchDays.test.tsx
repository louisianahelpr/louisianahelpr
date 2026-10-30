/**
 * Porch days (owner 2026-10-29, builder 23's leftover; migration 20261029161347, proof
 * src/test/pglite/declutterPorchWeekdays.pglite.mjs). Audit 1030 DC-3, lead decision 2026-10-30: ONE Sun-Sat
 * picker (the pickup times' Days). Under Porch pickup there is one choice, "Porch only on some of these days?";
 * ticking it offers ONLY the pickup days, on the same shared chip (DayChip), each tap saving the seller's days
 * (declutter_set_porch_days, kept with its fallback); unticking goes back to every pickup day. Hidden before
 * the migration is on the server.
 *
 * @mutate src/components/declutter/SellHandoverChoices.tsx |       {(free \|\| ways.includes("porch")) && <SellPorchDays pickupDays={pickupDays} />} |
 * @mutate src/components/declutter/SellHandoverChoices.tsx | <SellPorchDays pickupDays={pickupDays} /> | <SellPorchDays />
 * @mutate src/components/declutter/SellPorchDays.tsx | picked.includes(d) ? picked.filter((x) => x !== d) : [...picked, d].sort((a, b) => a - b) | [d]
 * @mutate src/components/declutter/SellPorchDays.tsx |   if (mine.data === PORCH_DAYS_NOT_DEPLOYED \|\| mine.isLoading) return null; |   if (mine.isLoading) return null;
 * @mutate src/components/declutter/SellPorchDays.tsx |   const offered = [...new Set([...pickup, ...picked])].sort((a, b) => a - b); |   const offered = [0, 1, 2, 3, 4, 5, 6];
 * @mutate src/components/declutter/SellPorchDays.tsx |   const offered = [...new Set([...pickup, ...picked])].sort((a, b) => a - b); |   const offered = pickup;
 * @mutate src/components/declutter/SellPorchDays.tsx |   const only = picked.length > 0 \|\| asked; |   const only = true;
 * @mutate src/components/declutter/SellPorchDays.tsx |     if (!on && picked.length) save.mutate([]); |
 * @mutate src/components/declutter/DeclutterPickupTimes.tsx | {SHORT.map((label, d) => <DayChip key={label} day={d} on={days.includes(d)} onToggle={() => toggleDay(d)} />)} | {SHORT.map((label, d) => <button key={label} type="button" aria-pressed={days.includes(d)} aria-label={WEEKDAYS[d]} onClick={() => toggleDay(d)} className="min-h-11 min-w-11 rounded-full border px-3 text-ds-14">{label}</button>)}
 * @mutate src/lib/declutter/porchDays.ts |   if (r.error && isMissingRpcNamed(r.error, "declutter_my_porch_days")) return PORCH_DAYS_NOT_DEPLOYED; |
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  savedWindows: [{ weekday: 2, starts_local: "09:00:00", ends_local: "12:00:00" }] as { weekday: number; starts_local: string; ends_local: string }[],
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: h.rpc,
    from: (table: string) => {
      const res = table === "declutter_pickup_windows" ? { data: h.savedWindows, error: null } : { data: null, error: { message: `unexpected ${table}` } };
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order"]) q[m] = () => q;
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok);
      return q;
    },
  },
}));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "seller-1" } }) }));

import { SellHandoverChoices } from "./SellHandoverChoices";
import { PickupTimesEditor } from "./DeclutterPickupTimes";
import type { PickupWindow } from "@/lib/declutter/api";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
function open(ways: ("porch" | "meetup")[] = ["porch"], pickupDays: number[] | null = [3, 6]) {
  return wrap(<SellHandoverChoices ways={ways} setWays={() => {}} free={false} sellerDeliveryOpen={false} pickupDays={pickupDays ?? undefined} />);
}
const porch = () => document.querySelector<HTMLElement>("[data-porch-days]")!;
const chipNames = () => within(porch()).queryAllByRole("button").map((b) => b.getAttribute("aria-label"));

describe("porch days: one choice, offering only the pickup days", () => {
  let stored: number[] | null;
  beforeEach(() => {
    stored = null;
    h.rpc.mockReset();
    h.rpc.mockImplementation(async (fn: string, args?: { p_weekdays: number[] }) => {
      if (fn === "declutter_my_porch_days") return { data: stored, error: null };
      if (fn === "declutter_set_porch_days") { stored = args!.p_weekdays.length ? args!.p_weekdays : null; return { data: args!.p_weekdays, error: null }; }
      return { data: null, error: { message: "unexpected" } };
    });
  });

  it("none picked: one unticked question, no second day picker; ticking offers only the pickup days", async () => {
    open();
    const ask = await screen.findByRole("checkbox", { name: "Porch only on some of these days?" });
    expect(ask).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Your pickup days: Wed, Sat.")).toBeInTheDocument();
    expect(screen.getByText("Buyers can pick any of your pickup days for porch pickup.")).toBeInTheDocument();
    expect(chipNames()).toEqual([]);
    fireEvent.click(ask);
    expect(chipNames()).toEqual(["Wednesday", "Saturday"]);
    expect(chipNames().length).toBeGreaterThan(1);
    expect(screen.getByText("Tap the days you put things out.")).toBeInTheDocument();
    expect(h.rpc).not.toHaveBeenCalledWith("declutter_set_porch_days", expect.anything());
    fireEvent.click(within(porch()).getByRole("button", { name: "Saturday" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("declutter_set_porch_days", { p_weekdays: [6] }));
    await waitFor(() => expect(within(porch()).getByRole("button", { name: "Saturday" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByText("Porch pickup only on Sat. This applies to all your listings.")).toBeInTheDocument();
  });

  it("days already picked: ticked, those pressed, each tap saves, unticking goes back to every pickup day", async () => {
    stored = [3];
    open();
    expect(await within(document.body).findByRole("button", { name: "Wednesday" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: "Porch only on some of these days?" })).toHaveAttribute("aria-checked", "true");
    expect(chipNames()).toEqual(["Wednesday", "Saturday"]);
    fireEvent.click(within(porch()).getByRole("button", { name: "Saturday" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("declutter_set_porch_days", { p_weekdays: [3, 6] }));
    await waitFor(() => expect(within(porch()).getByRole("button", { name: "Saturday" })).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Porch only on some of these days?" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("declutter_set_porch_days", { p_weekdays: [] }));
    await waitFor(() => expect(chipNames()).toEqual([]));
    expect(screen.getByText("Buyers can pick any of your pickup days for porch pickup.")).toBeInTheDocument();
  });

  it("a saved porch day that is no longer a pickup day stays shown, so it can be taken off", async () => {
    stored = [1];
    open(["porch"], [6]);
    expect(await within(document.body).findByRole("button", { name: "Monday" })).toHaveAttribute("aria-pressed", "true");
    expect(chipNames()).toEqual(["Monday", "Saturday"]);
  });

  it("Edit listing (no pickup-times editor beside it) offers the saved pickup days", async () => {
    stored = [2];
    open(["porch"], null);
    expect(await within(document.body).findByRole("button", { name: "Tuesday" })).toHaveAttribute("aria-pressed", "true");
    expect(chipNames()).toEqual(["Tuesday"]);
  });

  it("the porch chip and the pickup times' Days chip are the same chip", async () => {
    stored = [6];
    function Both() {
      const [ws, setWs] = useState<PickupWindow[]>([{ weekday: 6, starts: "09:00", ends: "12:00" }]);
      return (<>
        <div data-testid="times"><PickupTimesEditor windows={ws} setWindows={setWs} /></div>
        <SellHandoverChoices ways={["porch"]} setWays={() => {}} free={false} sellerDeliveryOpen={false} pickupDays={ws.map((w) => w.weekday)} />
      </>);
    }
    wrap(<Both />);
    await waitFor(() => expect(porch()).not.toBeNull());
    const porchSat = within(porch()).getByRole("button", { name: "Saturday" });
    const timesSat = within(screen.getByTestId("times")).getByRole("button", { name: "Saturday" });
    const timesSun = within(screen.getByTestId("times")).getByRole("button", { name: "Sunday" });
    expect(timesSat).toHaveAttribute("data-day-chip");
    expect(porchSat).toHaveAttribute("data-day-chip");
    expect(porchSat.className).toBe(timesSat.className);
    expect(porchSat.textContent).toBe(timesSat.textContent);
    // Adding a pickup day in the Days picker offers it as a porch day at once.
    fireEvent.click(timesSun);
    await waitFor(() => expect(chipNames()).toEqual(["Sunday", "Saturday"]));
  });

  it("not shown without porch pickup, nor before the server has it", async () => {
    open(["meetup"]);
    expect(document.querySelector("[data-porch-days]")).toBeNull();
    h.rpc.mockImplementation(async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.declutter_my_porch_days without parameters in the schema cache" } }));
    const { container } = open();
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("declutter_my_porch_days"));
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector("[data-porch-days]")).toBeNull();
    expect(container.querySelector("[role=alert]")).toBeNull();
    // Not an error either (ErrorState has no role, so look for its words).
    expect(screen.queryByText("We couldn't load your porch days.")).toBeNull();
  });
});
