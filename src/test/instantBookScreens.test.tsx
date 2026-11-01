/**
 * CMP-4 instant book, the member screens (lead 2026-11-01): the Helpr's private
 * floor settings (InstantBookTab), the poster's top 3 with Book now
 * (InstantBookPanel), the booked Helpr's Confirm / Decline with the 2-hour
 * countdown (InstantBookingCard), and every outcome in plain words.
 *
 * Also a class guard: every refusal the member instant-book RPCs raise (read
 * from the NEWEST definition of each, comments blanked) has words in
 * INSTANT_BOOK_REFUSALS, so a new refusal never reaches the screen as a code.
 *
 * @mutate src/components/jobs/InstantBookingCard.tsx |     if (res.holdMessage === BOOKING_ENDED_COPY) return done("ended"); |     if (false) return done("ended");
 * @mutate src/pages/profile/InstantBookTab.tsx |                 save.mutate({ category, cents: Math.round((amount as number) * 100) }); |                 save.mutate({ category, cents: Math.round(amount as number) });
 * @mutate src/pages/profile/InstantBookTab.tsx |                     onClick={() => save.mutate({ category: r.category, cents: null })} |                     onClick={() => save.mutate({ category: r.category, cents: 0 })}
 * @mutate src/pages/profile/InstantBookTab.tsx |             Your lowest price is private. Nobody else ever sees it. |             Your lowest price is shown to posters.
 * @mutate src/components/jobs/InstantBookPanel.tsx |   const list = (candidates.data ?? []).slice(0, 3); |   const list = (candidates.data ?? []).slice(0, 4);
 * @mutate src/components/jobs/InstantBookPanel.tsx |         onPrimary={(e) => { e.preventDefault(); if (confirm) book.mutate(confirm.helper_id); }} |         onPrimary={(e) => { e.preventDefault(); }}
 * @mutate src/components/jobs/InstantBookingCard.tsx |     const { error: e } = await supabase.rpc("rpc_instant_book_decline", { p_job_id: jobId }); |     const { error: e } = await supabase.rpc("respond_to_direct_offer", { p_job_id: jobId, p_accept: false });
 * @mutate src/components/jobs/InstantBookingCard.tsx |     if (rpcErrorCode("rpc_instant_book_decline", e) === "decline_window_closed") return done("booked_now"); |     if (false) return done("booked_now");
 * @mutate src/components/jobs/InstantBookingCard.tsx |       {left && ( |       {true && (
 * @mutate src/components/jobs/InstantBookingCard.tsx |           {left\n            ? <>Can |           {true\n            ? <>Can
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { blankSqlComments } from "@/test/helpers/blankNonCode";
import { newestFunction } from "@/test/helpers/parityReaders";

const ME = "00000000-0000-0000-0000-0000000000a1";
const JOB = "00000000-0000-0000-0000-0000000000b1";
const ANA = "00000000-0000-0000-0000-0000000000c1";

const db = vi.hoisted(() => ({
  floors: [] as { category: string; floor_cents: number }[],
  calls: [] as { fn: string; args: unknown }[],
  rpcError: {} as Record<string, { message: string } | undefined>,
  job: null as Record<string, unknown> | null,
  candidates: [] as Record<string, unknown>[],
}));
const capture = vi.hoisted(() => ({ result: { data: null, error: null } as { data: unknown; error: unknown; holdMessage?: string }, calls: 0 }));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: ME }, profile: null, isAdmin: false }) }));
vi.mock("@/lib/cardHoldCapture", () => ({
  withCardHoldCapture: async (_job: string, _run: unknown, opts: { knownHeld?: boolean }) => {
    capture.calls++;
    db.calls.push({ fn: "capture_hold", args: opts });
    return capture.result;
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      db.calls.push({ fn, args });
      const err = db.rpcError[fn];
      if (err) return Promise.resolve({ data: null, error: err });
      if (fn === "rpc_my_instant_book_floors") return Promise.resolve({ data: db.floors, error: null });
      if (fn === "instant_book_candidates") return Promise.resolve({ data: db.candidates, error: null });
      if (fn === "get_safe_profiles") return Promise.resolve({ data: [{ user_id: ANA, full_name: "Ana Able" }], error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from: () => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: db.job, error: null }) };
      return chain;
    },
  },
}));

import InstantBookTab from "@/pages/profile/InstantBookTab";
import { InstantBookPanel } from "@/components/jobs/InstantBookPanel";
import { InstantBookingCard, INSTANT_OUTCOME_COPY } from "@/components/jobs/InstantBookingCard";
import { BOOKING_ENDED_COPY, declineTimeLeft } from "@/lib/instantBook";
import { RPC_ERROR_COPY, rpcErrorMessage } from "@/lib/lifecycleErrors";

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>);
}
const NOW = Date.parse("2026-11-03T15:00:00Z");
/** The last match (the dialog's button, after the card's). */
const lastOf = <T,>(xs: T[]): T => xs[xs.length - 1];
const rpcCalls = (fn: string) => db.calls.filter((c) => c.fn === fn);

beforeEach(() => {
  db.floors = [];
  db.calls = [];
  db.rpcError = {};
  db.job = null;
  db.candidates = [];
  capture.result = { data: null, error: null };
  capture.calls = 0;
});
afterEach(cleanup);

describe("Helpr floor settings (private)", () => {
  it("says the price is private, lists floors, saves in cents, removes with NULL", async () => {
    db.floors = [{ category: "yard_work", floor_cents: 5000 }];
    wrap(<InstantBookTab onBack={() => {}} />);
    expect(await screen.findByText("Your lowest price is private. Nobody else ever sees it.")).toBeTruthy();
    expect(screen.getByText("At least $50")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Kind of work"), { target: { value: "moving" } });
    const amount = screen.getByLabelText("The least you'd take");
    fireEvent.focus(amount);
    fireEvent.change(amount, { target: { value: "75" } });
    fireEvent.blur(amount);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(rpcCalls("rpc_set_instant_book_floor")).toHaveLength(1));
    expect(rpcCalls("rpc_set_instant_book_floor")[0].args).toEqual({ p_category: "moving", p_floor_cents: 7500 });
    fireEvent.click(screen.getByRole("button", { name: /Remove/ }));
    await waitFor(() => expect(rpcCalls("rpc_set_instant_book_floor")).toHaveLength(2));
    expect(rpcCalls("rpc_set_instant_book_floor")[1].args).toEqual({ p_category: "yard_work", p_floor_cents: null });
  });

  it("at 3 kinds of work the form gives way to plain words; a refusal is worded, never a code", async () => {
    db.floors = [{ category: "yard_work", floor_cents: 5000 }, { category: "moving", floor_cents: 9000 }, { category: "cleaning", floor_cents: 4000 }];
    wrap(<InstantBookTab onBack={() => {}} />);
    expect(await screen.findByText("You've picked 3. Remove one to add another.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(rpcErrorMessage("rpc_set_instant_book_floor", { message: "too_many_categories" })).toMatch(/up to 3 kinds of work/);
  });
});

describe("the poster's top 3 and Book now", () => {
  const openHeld = { status: "open", helper_id: null, offered_to_helper_id: null, direct_offer_status: null, instant_decline_until: null, payment_status: "held" };
  const cand = (n: number) => ({ helper_id: `00000000-0000-0000-0000-00000000000${n}`, display_name: `Helpr${n} Person`, avatar_url: null, jobs_done: 4 + n, rating: 4.8, review_count: 5 });

  it("shows at most 3, says the card is held not charged for 2 hours, and Book now books that Helpr", async () => {
    db.job = openHeld;
    db.candidates = [cand(1), cand(2), cand(3), cand(4)];
    wrap(<InstantBookPanel jobId={JOB} now={NOW} />);
    expect(await screen.findAllByRole("button", { name: /^Book .* now$/ })).toHaveLength(3);
    expect(screen.getByText(/Your card is held, not charged, for 2 hours/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /^Book .* now$/ })[0]);
    expect(await screen.findByText(/They have 2 hours to decline. If they don't, your card is charged and they're hired./)).toBeTruthy();
    fireEvent.click(lastOf(screen.getAllByRole("button", { name: "Book now" })));
    await waitFor(() => expect(rpcCalls("rpc_instant_book")).toHaveLength(1));
    expect(rpcCalls("rpc_instant_book")[0].args).toEqual({ p_job_id: JOB, p_helper_id: cand(1).helper_id });
  });

  it("a Helpr who can no longer be booked is worded plainly", async () => {
    db.job = openHeld;
    db.candidates = [cand(1)];
    db.rpcError.rpc_instant_book = { message: "instant_book_unavailable" };
    wrap(<InstantBookPanel jobId={JOB} now={NOW} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Book .* now$/ }));
    fireEvent.click(lastOf((await screen.findAllByRole("button", { name: "Book now" }))));
    expect(await screen.findByText("That Helpr can't be booked now. Pick another, or wait for applications.")).toBeTruthy();
  });

  it("while booked: who, until when, the card held not charged, and the time left", async () => {
    db.job = { ...openHeld, offered_to_helper_id: ANA, direct_offer_status: "pending", instant_decline_until: new Date(NOW + 102 * 60_000).toISOString() };
    wrap(<InstantBookPanel jobId={JOB} now={NOW} />);
    expect(await screen.findByText(/Booked: Ana/)).toBeTruthy();
    expect(screen.getByText(/Your card is held, not charged/)).toBeTruthy();
    expect(screen.getByText("1 h 42 min left")).toBeTruthy();
  });

  it("nobody qualifies, or the job is not bookable: nothing at all", async () => {
    db.job = openHeld;
    const { container } = wrap(<InstantBookPanel jobId={JOB} now={NOW} />);
    await waitFor(() => expect(rpcCalls("instant_book_candidates")).toHaveLength(1));
    expect(container.querySelector("[data-instant-book]")).toBeNull();
  });
});

describe("the booked Helpr: Confirm, Decline, 2-hour countdown, every outcome", () => {
  const until = new Date(NOW + 90 * 60_000).toISOString();

  it("shows the countdown; Confirm is the held-card accept", async () => {
    wrap(<InstantBookingCard jobId={JOB} title="Mow the yard" declineUntil={until} now={NOW} />);
    expect(screen.getByText("1 h 30 min left to decline")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(INSTANT_OUTCOME_COPY.confirmed.body)).toBeTruthy();
    expect(db.calls.find((c) => c.fn === "capture_hold")?.args).toEqual({ knownHeld: true });
  });

  it("Decline asks first, then calls rpc_instant_book_decline: no strike, nothing charged", async () => {
    wrap(<InstantBookingCard jobId={JOB} title="Mow the yard" declineUntil={until} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(await screen.findByText(/No strike, and nothing is charged. The job opens again/)).toBeTruthy();
    fireEvent.click(lastOf(screen.getAllByRole("button", { name: "Decline" })));
    await waitFor(() => expect(rpcCalls("rpc_instant_book_decline")).toHaveLength(1));
    expect(await screen.findByText(INSTANT_OUTCOME_COPY.declined.body)).toBeTruthy();
    expect(rpcCalls("respond_to_direct_offer")).toHaveLength(0);
  });

  it("decline_window_closed: the card says they're booked, in words", async () => {
    db.rpcError.rpc_instant_book_decline = { message: "decline_window_closed" };
    wrap(<InstantBookingCard jobId={JOB} title="Mow the yard" declineUntil={until} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    fireEvent.click(lastOf((await screen.findAllByRole("button", { name: "Decline" }))));
    expect(await screen.findByText("The 2 hours to decline have ended, so you're booked.")).toBeTruthy();
  });

  it("a Confirm whose hire was refused after the charge: \"your booking didn't go through\", never an error code", async () => {
    capture.result = { data: null, error: { message: "payment_not_captured" }, holdMessage: BOOKING_ENDED_COPY };
    wrap(<InstantBookingCard jobId={JOB} title="Mow the yard" declineUntil={until} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(INSTANT_OUTCOME_COPY.ended.body)).toBeTruthy();
  });

  it("past the 2 hours the buttons go and the card says they're booked", () => {
    wrap(<InstantBookingCard jobId={JOB} title="Mow the yard" declineUntil={new Date(NOW - 1000).toISOString()} now={NOW} />);
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    expect(screen.getByText("The 2 hours to decline have ended, so you're booked.")).toBeTruthy();
    // Never "Decline by ..." once the window is over (seen on the 375 shot, 2026-11-01).
    expect(screen.queryByText(/Decline by/)).toBeNull();
    expect(declineTimeLeft(new Date(NOW + 30_000).toISOString(), NOW)).toBe("Less than a minute left");
  });
});

describe("class guard: every refusal the member instant-book RPCs raise has words", () => {
  const MEMBER_RPCS = ["rpc_set_instant_book_floor", "rpc_my_instant_book_floors", "rpc_instant_book", "rpc_instant_book_decline", "instant_book_candidates"] as const;
  it("reads the newest definition of each and finds every RAISE code in RPC_ERROR_COPY for that RPC", () => {
    let n = 0;
    const unworded: string[] = [];
    for (const fn of MEMBER_RPCS) {
      const body = blankSqlComments(newestFunction(fn).body);
      for (const m of body.matchAll(/RAISE\s+EXCEPTION\s+'([a-z_]+)'/g)) {
        n++;
        if (!(RPC_ERROR_COPY[fn] as Record<string, string>)[m[1]]) unworded.push(`${fn}: ${m[1]}`);
      }
    }
    expect(n).toBeGreaterThan(8);
    expect(unworded).toEqual([]);
    // decline_window_closed through the generic decline too (the race fix, lead 2026-11-01).
    expect(RPC_ERROR_COPY.respond_to_direct_offer.decline_window_closed).toBe("The 2 hours to decline have ended, so you're booked.");
  });
});
