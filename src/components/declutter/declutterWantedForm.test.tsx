/**
 * Board 116, Post a Wanted, kept to what declutter_create_wanted stores: what,
 * category, highest price ("Up to", in money ink), distance. The board's
 * "How you'd get it", details and reference photo have no server fields, and a
 * Wanted is private (sellers get a heads-up with the price, never the
 * poster's name or words), so nothing says neighbors can reply.
 *
 * @mutate src/components/declutter/DeclutterWantedViews.tsx | <p className="text-ds-13 text-muted-foreground">Your Wanted stays up 30 days. You can close it anytime.</p> |
 * @mutate src/components/declutter/DeclutterWantedViews.tsx | className="w-full min-w-0 self-stretch rounded-xl bg-transparent font-semibold text-[hsl(var(--burnt-sienna))] outline-none | className="w-full min-w-0 self-stretch rounded-xl bg-transparent font-semibold outline-none
 * Q2267 (owner 10-21): "Let sellers near me reply" is ON by default, in plain view, with what sellers see.
 * @mutate src/components/declutter/DeclutterWantedViews.tsx | radius: 10, public: true }; | radius: 10, public: false };
 * @mutate src/components/declutter/DeclutterWantedViews.tsx | <p className="text-ds-13 text-muted-foreground">Sellers near you see your first name, what you want and your max price, never your address.</p> |
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const posted: unknown[] = [];
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false }) }));
// The "Wanted near you" section has its own test (declutterWantedReplies.test.tsx).
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null }) }));
vi.mock("./useDeclutterOrigin", () => ({
  useDeclutterOrigin: () => ({ origin: { status: "ready", lat: 30, lng: -92, approximate: false }, askDevice: () => {}, asked: false, asking: false, deviceNote: null }),
}));
vi.mock("@/lib/declutter/wanted", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/wanted")>()),
  fetchMyWanted: async () => [],
  createWanted: async (f: unknown, at: unknown) => { posted.push([f, at]); return { id: "w1", repliesOn: true }; },
}));

import { WantedView } from "./DeclutterWantedViews";

describe("board 116: Post a Wanted", () => {
  beforeEach(() => { posted.length = 0; });
  it("Q2267: replies are on by default with the plain line; turning them off posts privately", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><WantedView /></MemoryRouter></QueryClientProvider>);
    const sw = await screen.findByRole("switch", { name: "Let sellers near me reply" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Sellers near you see your first name, what you want and your max price, never your address.")).toBeInTheDocument();
    fireEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/Only you see your post\./)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("I'm looking for"), { target: { value: "Crib" } });
    fireEvent.change(screen.getByLabelText("Up to"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "baby_kids" } });
    fireEvent.click(screen.getByRole("button", { name: "Post Wanted" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect((posted[0] as unknown[])[0]).toEqual(expect.objectContaining({ public: false }));
  });

  it("asks only what the server stores, shows the price in money ink, the 30-day rule, and posts", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><WantedView /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole("heading", { name: "What are you looking for?" })).toBeInTheDocument();
    for (const gone of [/How you'd get it/, /Details/, /reference photo/i, /can reply/i]) expect(screen.queryByText(gone)).toBeNull();
    expect(screen.getByText("Your Wanted stays up 30 days. You can close it anytime.")).toBeInTheDocument();
    const price = screen.getByLabelText("Up to");
    expect(price.className).toContain("--burnt-sienna");
    fireEvent.change(screen.getByLabelText("I'm looking for"), { target: { value: "Kids bike, 16 inch" } });
    fireEvent.change(price, { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "baby_kids" } });
    fireEvent.click(screen.getByRole("button", { name: "Post wanted" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual([expect.objectContaining({ what: "Kids bike, 16 inch", maxPrice: "30", category: "baby_kids" }), { lat: 30, lng: -92 }]);
  });
});
