/**
 * A3-64 (audit 7, 11-01): Declutter settings showed "Meet spots" (each with its own times) and, right under it, a
 * "Meetup times" card summarised as "2 pickup times". The seller couldn't tell which times a buyer sees for a meetup.
 * These usual times apply to the police safe spots (and an own spot with no times of its own), so the card is named
 * for that and lists the hours themselves.
 *
 * @mutate src/components/declutter/MeetupTimesCard.tsx | <span className="block text-sm font-semibold">Police spot meetup times</span> | <span className="block text-sm font-semibold">Meetup times</span>
 * @mutate src/components/declutter/MeetupTimesCard.tsx | rows.length ? weekHoursLine(toWindows(rows)) : "None yet" | rows.length ? `${rows.length} pickup times` : "None yet"
 * @mutate src/components/declutter/MeetupTimesCard.tsx | When you can meet a buyer at a police safe exchange spot, or at one of your meet spots with no times of its own. | When you can meet a buyer at a safe meeting spot.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/api")>()),
  fetchMyPickupWindows: vi.fn(async () => [
    { weekday: 6, starts_local: "09:00:00", ends_local: "12:00:00" },
    { weekday: 0, starts_local: "13:00:00", ends_local: "17:00:00" },
  ]),
  setPickupWindows: vi.fn(),
}));
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/sellerDefaults")>()),
  fetchSellerDefaults: vi.fn(async () => ({ handovers: ["porch", "meetup"] })),
}));
import { MeetupTimesCard } from "@/components/declutter/MeetupTimesCard";

describe("A3-64: the meetup times card says which meetups it is for", () => {
  it("is named for police spots and lists the hours, never 'N pickup times'", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MeetupTimesCard userId="u1" /></QueryClientProvider>);
    const title = await screen.findByText("Police spot meetup times");
    const card = title.closest("[data-meetup-times-card]") as HTMLElement;
    expect(card.getAttribute("aria-label")).toBe("Police spot meetup times");
    await screen.findByText(/9 AM–12 PM/);
    expect(card.textContent).toMatch(/Sat 9 AM–12 PM/);
    expect(card.textContent).toMatch(/Sun 1–5 PM/);
    expect(card.textContent).not.toMatch(/pickup times/i);
    fireEvent.click(screen.getByRole("button", { name: /Police spot meetup times/ }));
    expect(card.textContent).toMatch(/police safe exchange spot, or at one of your meet spots with no times of its own/);
    expect(screen.getByRole("button", { name: "Save times" })).toBeTruthy();
  });
});
