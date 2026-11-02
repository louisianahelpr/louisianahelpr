/**
 * Board 117 / Q2267: "Wanted near you" and "I have this". A post shows First L., "Up to" in money ink and whole
 * miles, never an address; one you answered says so. The sheet answers with one of YOUR live listings, the price
 * starts at the lower of their Wanted price and your listing's price, can't go over it, and says you keep the
 * whole price. No pronouns.
 *
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx |   const tooHigh = cents !== null && limit !== null && cents > limit; |   const tooHigh = false;
 * A3-80 (audit 2026-11-01): before Send, the sheet says the buyer has 48 hours and the listing stays up meanwhile.
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx | Your listing stays up at {formatPrice(item.current_price_cents)}; | Your listing stays up;
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx |     if (post && it) setPrice(String(Math.min(post.max_price_cents, it.current_price_cents) / 100)); |     if (post && it) setPrice(String(it.current_price_cents / 100));
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx |     mutationFn: () => replyToWanted(post!.id, itemId!, cents!), |     mutationFn: () => replyToWanted(post!.id, itemId!, limit!),
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx |             {w.replied ? ( |             {false ? (
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx |                 <Link to={quickListHref(post)}> |                 <Link to="/declutter/sell">
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx |               <div className="min-w-0 space-y-2"> |               <div className="space-y-2">
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx |       clearPick();\n      void qc.invalidateQueries({ queryKey: ["declutter"] }); |       void qc.invalidateQueries({ queryKey: ["declutter"] });
 * @mutate src/lib/declutter/wanted.ts |   return item.current_price_cents >= 100; |   return true;
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx |   const listings = (mine.data ?? []).filter((i) => canAnswerWanted(i) && !i.refuses); |   const listings = (mine.data ?? []).filter(canAnswerWanted);
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx |     if (startAt) pick(startAt); |
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx |     next.delete("answer"); |
 * @mutate src/lib/declutter/wanted.ts |   return near.find((w) => w.id === wantedId) ?? null; |   return near[0] ?? null;
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx |             <div className="w-full"><WantedPostSafety post={w} /></div>\n |
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx | onConfirm={() => block.mutate()} | onConfirm={() => {}}
 *
 * Audit W1 (the sheet slid sideways on WebKit): the listings are the shared RadioCardList inside a min-w-0 box.
 * Quick-list (owner 2026-10-30): "List it now" opens the shared sell flow with the post to answer.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  near: [] as unknown[],
  listings: [] as { id: string; title: string; current_price_cents: number; refuses?: string | null }[],
  sent: [] as unknown[][],
  fromAlert: [] as unknown[],
  blocked: [] as string[],
  blockFails: false,
  blockTries: 0,
};
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("@/lib/declutter/wanted", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/wanted")>()),
  fetchWantedNear: async () => state.near,
  fetchMyReplyListings: async () => state.listings,
  blockWantedPoster: async (id: string) => {
    state.blockTries += 1;
    if (state.blockFails) throw new Error("wanted_block_shared_job");
    state.blocked.push(id);
    return "blocked";
  },
  fetchWantedFromAlert: async (id: string) => state.fromAlert.find((p) => (p as { id: string }).id === id) ?? null,
  replyToWanted: async (...a: unknown[]) => { state.sent.push(a); return "o1"; },
}));

import { toast } from "sonner";
import { WantedNearSection } from "./DeclutterWantedReplies";

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.search}</p>;
}

const POST = { id: "w1", what: "Kids bike, 16 inch", category: "baby_kids", max_price_cents: 3000, poster_name: "Lexi L.", miles: 4, expires_at: "2026-11-20", replied: false };

function renderIt(url = "/declutter?tab=wanted") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[url]}><Where /><WantedNearSection at={{ lat: 30, lng: -92 }} userId="s1" /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  state.near = [POST, { ...POST, id: "w2", what: "Crib", replied: true }];
  state.listings = [{ id: "i1", title: "Blue kids bike", current_price_cents: 4000 }, { id: "i2", title: "Trike", current_price_cents: 2000 }];
  state.sent = [];
  state.fromAlert = [];
  state.blocked = [];
  state.blockFails = false;
  state.blockTries = 0;
});

describe("board 117: Wanted near you and I have this", () => {
  it("lists posts with First L., money-ink 'Up to' and miles; an answered one says so", async () => {
    renderIt();
    expect(await screen.findByRole("heading", { name: "Wanted near you" })).toBeInTheDocument();
    // The heading stands from the start now (the hub, owner 2026-10-30); the rows arrive with the answer.
    const rows = await screen.findAllByRole("listitem");
    expect(rows[0].textContent).toContain("Up to $30 · Lexi L. · 4 mi");
    expect(within(rows[0]).getByText("$30").className).toContain("--burnt-sienna");
    expect(within(rows[1]).getByText("Answered")).toBeInTheDocument();
    expect(within(rows[1]).queryByRole("button", { name: "I have this" })).toBeNull();
  });

  it("answers with your listing at the lower of the two prices, never above it, and you keep the whole price", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "I have this" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Kids bike, 16 inch")).toBeInTheDocument();
    // W1: the shared radio cards, in a box that can shrink below its content (min-w-0), so a long title wraps.
    const card = await within(sheet).findByRole("radio", { name: /Blue kids bike/ });
    expect(card.closest("[role=radiogroup]")?.parentElement?.className).toContain("min-w-0");
    expect(within(sheet).getByRole("link", { name: "List something new for this" })).toHaveAttribute("href", "/declutter/sell?answer=w1&max=3000&what=Kids+bike%2C+16+inch");
    fireEvent.click(card);
    const price = within(sheet).getByLabelText("Your price");
    expect(price).toHaveValue("30");
    expect(within(sheet).getByText(/You keep the whole/).textContent).toBe("You keep the whole $30. If Lexi accepts, Lexi pays and you're paid after the handover.");
    expect(within(sheet).getByText(/48 hours to accept/).textContent).toBe("Lexi has 48 hours to accept. Your listing stays up at $40; if someone else buys it first, this answer ends.");
    expect(sheet.textContent).not.toMatch(/\b(he|she|his|her)\b/);
    fireEvent.change(price, { target: { value: "31" } });
    expect(within(sheet).getByRole("alert").textContent).toContain("Up to $30, the lower of their Wanted price and your listing's price.");
    expect(within(sheet).getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.change(price, { target: { value: "25" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Send to Lexi · $25" }));
    await waitFor(() => expect(state.sent).toEqual([["w1", "i1", 2500]]));
  });

  it("no listing that can answer: List it now opens the sell flow with this post to answer", async () => {
    state.listings = [];
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "I have this" }));
    expect(await screen.findByRole("link", { name: "List it now" })).toHaveAttribute("href", "/declutter/sell?answer=w1&max=3000&what=Kids+bike%2C+16+inch");
    expect(screen.getByText(/it answers Lexi as soon as it's live/)).toBeInTheDocument();
  });

  // Audit 10-30 #6: the next post starts clean, so one tap on Send can never offer a bike to someone wanting a crib.
  it("after Send, the next I have this has no listing picked and no price", async () => {
    state.near = [POST, { ...POST, id: "w3", what: "Crib" }];
    renderIt();
    fireEvent.click((await screen.findAllByRole("button", { name: "I have this" }))[0]);
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(await within(sheet).findByRole("radio", { name: /Blue kids bike/ }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Send to Lexi · $30" }));
    await waitFor(() => expect(state.sent).toEqual([["w1", "i1", 3000]]));
    // The sheet hides the page from the role query while it is open, so these appear only once it has closed.
    fireEvent.click((await screen.findAllByRole("button", { name: "I have this" }))[1]);
    const next = await screen.findByRole("dialog");
    expect(within(next).getByText("Crib")).toBeInTheDocument();
    for (const r of await within(next).findAllByRole("radio")) expect(r).toHaveAttribute("aria-checked", "false");
    expect(within(next).queryByLabelText("Your price")).toBeNull();
    expect(within(next).getByRole("button", { name: "Send" })).toBeDisabled();
  });

  // Audit 10-30 #12: a free listing has no price to offer, so it is not a choice; the sheet says why.
  it("a free listing is not offered as an answer, and the sheet says why", async () => {
    state.listings = [{ id: "i1", title: "Blue kids bike", current_price_cents: 4000 }, { id: "i9", title: "Free moving boxes", current_price_cents: 0 }];
    renderIt();
    fireEvent.click((await screen.findAllByRole("button", { name: "I have this" }))[0]);
    const sheet = await screen.findByRole("dialog");
    await within(sheet).findByRole("radio", { name: /Blue kids bike/ });
    expect(within(sheet).queryByRole("radio", { name: /Free moving boxes/ })).toBeNull();
    expect(within(sheet).getByText(/Free listings can't answer a Wanted/)).toBeInTheDocument();
  });

  it("only free listings: no dead $0 choice, and List it now stays", async () => {
    state.listings = [{ id: "i9", title: "Free moving boxes", current_price_cents: 0 }];
    renderIt();
    fireEvent.click((await screen.findAllByRole("button", { name: "I have this" }))[0]);
    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByRole("link", { name: "List it now" })).toBeInTheDocument();
    expect(within(sheet).queryAllByRole("radio")).toHaveLength(0);
    expect(within(sheet).getByText(/Free listings can't answer a Wanted/)).toBeInTheDocument();
  });

  // Audit 10-30 #12: what the server would refuse is not a choice, and the sheet says why before Send.
  it("a listing too far away or with an open offer isn't a choice, and the sheet says why", async () => {
    state.listings = [
      { id: "i1", title: "Blue kids bike", current_price_cents: 4000, refuses: null },
      { id: "i2", title: "Far trike", current_price_cents: 2000, refuses: "too_far" },
      { id: "i3", title: "Busy scooter", current_price_cents: 2000, refuses: "open_offer" },
    ];
    renderIt();
    fireEvent.click((await screen.findAllByRole("button", { name: "I have this" }))[0]);
    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findAllByRole("radio")).toHaveLength(1);
    expect(sheet.querySelector("[data-wanted-too-far]")!.textContent).toContain("Far trike");
    expect(sheet.querySelector("[data-wanted-has-offer]")!.textContent).toContain("Busy scooter");
  });

  // Audit 10-30 #5: the seller's alert opens the answer, with their listing picked, once.
  it("from the seller's alert: I have this opens on that post with that listing picked, and the address forgets it", async () => {
    state.fromAlert = [{ ...POST, id: "w7", what: "Oak dresser", max_price_cents: 3000 }];
    renderIt("/declutter?tab=wanted&answer=w7&item=i1");
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Oak dresser")).toBeInTheDocument();
    expect(await within(sheet).findByRole("radio", { name: /Blue kids bike/ })).toHaveAttribute("aria-checked", "true");
    expect(within(sheet).getByLabelText("Your price")).toHaveValue("30");
    await waitFor(() => expect(document.querySelector('[data-testid="where"]')!.textContent).toBe("?tab=wanted"));
    fireEvent.click(within(sheet).getByRole("button", { name: "Send to Lexi · $30" }));
    await waitFor(() => expect(state.sent).toEqual([["w7", "i1", 3000]]));
  });

  it("from an alert on a post that has closed: says so, and opens nothing", async () => {
    renderIt("/declutter?tab=wanted&answer=gone&item=i1");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That post has closed, or your listing is no longer close enough to answer it."));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Audit 10-30 #8: Report and Block on each post.
  it("each post can be reported and blocked, and a block asks first", async () => {
    state.near = [POST];
    renderIt();
    const card = (await screen.findByRole("button", { name: "I have this" })).closest("li")!;
    expect(within(card).getByRole("button", { name: "Report" })).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Block" }));
    const confirm = await screen.findByRole("dialog");
    expect(state.blocked).toEqual([]);
    expect(confirm.textContent).toContain("If you have a job together, this stops and nothing changes");
    expect(confirm.textContent).not.toContain("cancelled");
    fireEvent.click(within(confirm).getByRole("button", { name: "Block" }));
    await waitFor(() => expect(state.blocked).toEqual(["w1"]));
  });

  it("a block the server refuses over a shared job closes the question and blocks nothing", async () => {
    state.near = [POST];
    state.blockFails = true;
    renderIt();
    const card = (await screen.findByRole("button", { name: "I have this" })).closest("li")!;
    fireEvent.click(within(card).getByRole("button", { name: "Block" }));
    const confirm = await screen.findByRole("dialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Block" }));
    await waitFor(() => expect(state.blockTries).toBe(1));
    expect(state.blocked).toEqual([]);
  });

  it("the I have this sheet offers Report and Block too", async () => {
    state.near = [POST];
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "I have this" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("button", { name: "Report" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Block" })).toBeInTheDocument();
  });

  // Audit 10-30 #19: the seller sees every photo, and can open it large.
  it("I have this shows every photo of the post, and a tap opens it large", async () => {
    state.near = [{ ...POST, photo_path: "u/wanted/w1/a.jpg", photo_paths: ["u/wanted/w1/a.jpg", "u/wanted/w1/b.jpg"] }];
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "I have this" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("button", { name: "See photo 2 of Kids bike, 16 inch" })).toBeInTheDocument();
    expect(within(sheet).getAllByRole("button", { name: /See photo/ })).toHaveLength(2);
  });

  // Owner 2026-10-30: the Wanted tab is a hub, so "Wanted near you" always stands and says when it has nothing.
  it("nothing near you: the section says so, with no I have this", async () => {
    state.near = [];
    renderIt();
    expect(await screen.findByText(/No one near you has posted a Wanted yet/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Wanted near you" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I have this" })).toBeNull();
  });
});
