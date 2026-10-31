/**
 * Lead's product call on the LEAD-PLACE-TIMES review (2026-10-31): the seller's usual times stay only for meetups,
 * shown in Declutter settings as "Meetup times", and only when the seller offers a safe meetup.
 *
 * @mutate src/components/declutter/MeetupTimesCard.tsx |   if (!defaults.data?.handovers.includes("meetup")) return null; |   if (!defaults.data) return null;
 * @mutate src/pages/declutter/DeclutterSettingsPage.tsx |         <MeetupTimesCard userId={user.id} />\n |
 */
import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";

const h = vi.hoisted(() => ({
  handovers: ["meetup"] as string[],
  rows: [{ weekday: 6, starts_local: "09:00:00", ends_local: "12:00:00" }],
  saves: [] as unknown[],
}));
vi.mock("@/lib/declutter/sellerDefaults", () => ({
  fetchSellerDefaults: async () => ({ keepUp: true, drops: true, dropPct: 10, floorPct: 50, freeAfterDays: null, handovers: h.handovers }),
}));
vi.mock("@/lib/declutter/api", () => ({
  fetchMyPickupWindows: async () => h.rows,
  setPickupWindows: async (w: unknown) => { h.saves.push(w); return 1; },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
import { MeetupTimesCard } from "./MeetupTimesCard";

const wrap = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeetupTimesCard userId="u1" /></QueryClientProvider>);
afterEach(cleanup);
beforeEach(() => { h.handovers = ["meetup"]; h.saves.length = 0; });

describe("Meetup times in Declutter settings", () => {
  it("shows as Meetup times when a meetup is offered, and saves the times", async () => {
    wrap();
    const open = await screen.findByRole("button", { name: /Meetup times/ });
    expect(open.textContent).toContain("Sat 9:00 AM–12:00 PM");
    fireEvent.click(open);
    fireEvent.click(screen.getByRole("button", { name: "Save meetup times" }));
    await waitFor(() => expect(h.saves).toHaveLength(1));
    expect(h.saves[0]).toEqual([{ weekday: 6, starts: "09:00", ends: "12:00" }]);
  });

  it("hidden when no meetup is offered", async () => {
    h.handovers = ["porch", "delivery"];
    const { container } = wrap();
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector("[data-meetup-times-card]")).toBeNull();
    expect(screen.queryByText(/Pickup times/)).toBeNull();
  });

  it("the settings page has it (source)", () => {
    const src = blankComments(readFileSync("src/pages/declutter/DeclutterSettingsPage.tsx", "utf8"));
    expect(src).toContain("<MeetupTimesCard userId={user.id} />");
  });
});
