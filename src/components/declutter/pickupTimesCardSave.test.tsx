/**
 * NIGHT-SET-Declutterse-6 (settings audit 10-30 #6): Declutter settings > Pickup times kept "Save pickup times" on
 * with no day picked (it sent p_windows: [] and only the server's refusal stopped it) and with an end before its
 * start. Save is now off whenever pickupWindowsProblem names a problem; the editor already says why.
 *
 * @mutate src/components/declutter/DeclutterPickupTimes.tsx | disabled={save.isPending \|\| !!problem} | disabled={save.isPending}
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const sent = vi.hoisted(() => ({ windows: [] as unknown[] }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/api")>()),
  fetchMyPickupWindows: async () => [{ weekday: 6, starts_local: "09:00:00", ends_local: "12:00:00" }],
  setPickupWindows: async (w: unknown) => { sent.windows.push(w); },
}));

import { PickupTimesCard } from "./DeclutterPickupTimes";

async function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><PickupTimesCard userId="u1" /></QueryClientProvider>);
  await screen.findByText("Saturday 9:00 AM to 12:00 PM");
  fireEvent.click(screen.getByRole("button", { name: /Pickup times/ }));
  return screen.getByRole("button", { name: "Save pickup times" });
}

describe("Declutterse-6: Pickup times can't be saved broken", () => {
  it("the saved times open with Save on", async () => {
    expect(await open()).toBeEnabled();
  });

  it("no day picked: Save is off and the editor says why", async () => {
    const save = await open();
    fireEvent.click(screen.getByRole("button", { name: "Saturday" }));
    expect(screen.getByText("Pick at least one day buyers can come.")).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(sent.windows).toHaveLength(0);
  });

  it("an end before its start: Save is off and the editor says why", async () => {
    const save = await open();
    fireEvent.change(screen.getByLabelText("Until"), { target: { value: "08:00" } });
    expect(screen.getByText("The end time must be after the start.")).toBeInTheDocument();
    expect(save).toBeDisabled();
  });
});
