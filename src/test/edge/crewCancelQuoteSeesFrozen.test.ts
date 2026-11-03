/**
 * Q2557 (Q1415 e follow-up): the crew cancel dialog showed a higher fee than a crew cancel charges when a member
 * is banned or under an open ban review (or waiting on their ID check). poster_cancel_job (20261102074317) gives
 * such a member a 0% share; the client's crewCancellationFeeQuote cannot read cancel_fee_payee_frozen (service role
 * only) and charged them in the quote.
 *
 * Fix: create-payment cancel_quote prices a crew the way poster_cancel_job does (_shared/crewCancelQuote.ts) and
 * returns the total only (no member named); the dialog shows it, and a crew cancel still sends no
 * p_expected_fee_cents.
 *
 * Each case runs the REAL create-payment source with the edge harness, or renders the REAL dialog.
 *
 * @mutate supabase/functions/_shared/crewCancelQuote.ts |     const committed = crewMemberCommitted(m.confirmed) && !m.idWaits && !m.frozen; |     const committed = crewMemberCommitted(m.confirmed) && !m.idWaits;
 * @mutate supabase/functions/_shared/crewCancelQuote.ts |     const committed = crewMemberCommitted(m.confirmed) && !m.idWaits && !m.frozen; |     const committed = crewMemberCommitted(m.confirmed) && !m.frozen;
 * @mutate supabase/functions/_shared/crewCancelQuote.ts |     if (idWaits === null \|\| frozen === null) return null; |     if (idWaits === null) return null;
 * @mutate supabase/functions/_shared/crewCancelQuote.ts |   if (error) return error.code === "PGRST202" ? false : null; |   if (error) return false;
 * @mutate supabase/functions/_shared/crewCancelQuote.ts |   const rows = (data as RosterRow[]).filter((r) => r.helper_id).sort(byHireOrder); |   const rows = (data as RosterRow[]).filter((r) => r.helper_id);
 * @mutate supabase/functions/create-payment/index.ts |         return unquoted("crew", crewFee ? crewFee.cents : null); |         return unquoted("crew", null);
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { blankSqlComments } from "../helpers/blankNonCode";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs";
import { crewCancelFeeCents } from "../../../supabase/functions/_shared/crewCancelQuote";

const POSTER = { id: "poster-1", email: "poster@test.com" };
// 2024-10-21 15:00Z is 10:00 in Louisiana; a 16:00 start is 6 h out (the 25% tier).
const NOW = new Date("2024-10-21T15:00:00.000Z");

const crewJob = (over: Record<string, unknown> = {}) => ({
  id: "job-crew", title: "Move a piano", customer_id: POSTER.id, helper_id: null, helper_confirmed_at: null,
  status: "accepted", payment_status: "escrow", budget: 300, date_needed: "2024-10-21", start_time: "16:00:00",
  is_group_job: true, helpers_needed: 3, helper_completed_at: null, stripe_payment_intent_id: "pi_c", stripe_session_id: null,
  ...over,
});
// Three confirmed members, $100 each. h2 is under ban review.
const roster = [
  { id: "g3", helper_id: "h3", share_cents: 10000, helper_confirmed_at: "2024-10-20T12:00:00Z", helper_on_the_way_at: null, helper_arrived_at: null, joined_at: "2024-10-19T12:00:00Z" },
  { id: "g1", helper_id: "h1", share_cents: 10000, helper_confirmed_at: "2024-10-20T12:00:00Z", helper_on_the_way_at: null, helper_arrived_at: null, joined_at: "2024-10-17T12:00:00Z" },
  { id: "g2", helper_id: "h2", share_cents: 10000, helper_confirmed_at: "2024-10-20T12:00:00Z", helper_on_the_way_at: null, helper_arrived_at: null, joined_at: "2024-10-18T12:00:00Z" },
];

async function quote(opts: { frozen?: string[]; idWaits?: string[]; frozenErr?: { message: string; code?: string }; rows?: unknown[] } = {}) {
  resetEnv(); resetSupabaseMock(); resetStripeMock(); resetSharedMocks();
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_crew" });
  scenario.authUser = POSTER;
  scenario.reads.jobs = { rows: [crewJob()] };
  scenario.reads.group_job_helpers = { rows: opts.rows ?? roster };
  scenario.rpc.cancel_fee_payee_frozen = (a?: unknown) => (opts.frozen ?? []).includes((a as { p_user: string }).p_user);
  scenario.rpc.payout_waits_on_identity = (a?: unknown) => (opts.idWaits ?? []).includes((a as { p_user_id: string }).p_user_id);
  if (opts.frozenErr) scenario.rpcErrors = { ...(scenario.rpcErrors ?? {}), cancel_fee_payee_frozen: opts.frozenErr };
  const fn = await loadEdgeFunction("create-payment");
  const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer test-jwt" }, body: { action: "cancel_quote", jobId: "job-crew" } }));
  expect(res.status).toBe(200);
  expect(scenario.writes).toHaveLength(0);
  expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  return JSON.parse(await res.text()) as Record<string, unknown>;
}

describe("cancel_quote prices a crew as poster_cancel_job does (Q2557)", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it("nobody frozen: 25% of each of three $100 shares, $75", async () => {
    const q = await quote();
    expect(q).toMatchObject({ can_cancel: true, fee_cents: 7500, fee_percent: 25, back_to_you_cents: null, unquoted_reason: "crew" });
  });

  it("a member under ban review counts 0, as poster_cancel_job records it: $50, and the answer names no member", async () => {
    const q = await quote({ frozen: ["h2"] });
    expect(q.fee_cents).toBe(5000);
    expect(JSON.stringify(q)).not.toMatch(/h2|g2/);
  });

  it("a member waiting on their ID check counts 0 too", async () => {
    const q = await quote({ idWaits: ["h1"] });
    expect(q.fee_cents).toBe(5000);
  });

  it("every member frozen: no fee and the 0 tier", async () => {
    const q = await quote({ frozen: ["h1", "h2", "h3"] });
    expect(q).toMatchObject({ fee_cents: 0, fee_percent: 0 });
  });

  it("an unreadable freeze quotes no fee (the dialog keeps its own estimate); not deployed (PGRST202) is the old rule", async () => {
    expect((await quote({ frozenErr: { message: "boom", code: "XX000" } })).fee_cents).toBeNull();
    expect((await quote({ frozenErr: { message: "missing", code: "PGRST202" } })).fee_cents).toBe(7500);
  });

  it("a roster row with no share is priced on its slot share in hire order (joined_at, then id)", async () => {
    // $100.01 over 3 slots in hire order: h1 (joined first) 3334, h2 3334, h3 (joined last) 3333. h3 never
    // confirmed, so h1's and h2's 3334 are on the 25% tier: 834 + 834. In the rows' stored order (h3 first) h3 would
    // hold a 3334 slot and h2 the 3333 one: 834 + 833.
    const rows = roster.map((r) => ({ ...r, share_cents: null, helper_confirmed_at: r.helper_id === "h3" ? null : r.helper_confirmed_at }));
    const q = await quoteWithBudget(100.01, rows);
    expect(q.fee_cents).toBe(834 + 834);
  });
});

async function quoteWithBudget(budget: number, rows: unknown[]) {
  resetEnv(); resetSupabaseMock(); resetStripeMock(); resetSharedMocks();
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_crew" });
  scenario.authUser = POSTER;
  scenario.reads.jobs = { rows: [crewJob({ budget })] };
  scenario.reads.group_job_helpers = { rows };
  scenario.rpc.cancel_fee_payee_frozen = false;
  scenario.rpc.payout_waits_on_identity = false;
  const fn = await loadEdgeFunction("create-payment");
  const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer test-jwt" }, body: { action: "cancel_quote", jobId: "job-crew" } }));
  return JSON.parse(await res.text()) as Record<string, unknown>;
}

describe("the TS twin reads the same two flags the SQL does", () => {
  it("poster_cancel_job's crew pricing counts a member committed only when not waiting on ID and not frozen", () => {
    const def = effectiveDefs("supabase/migrations").get("poster_cancel_job");
    const body = blankSqlComments(def?.stmt ?? "");
    const crewInsert = body.slice(body.search(/INSERT\s+INTO\s+public\.crew_cancellation_fee_shares/i));
    expect(crewInsert.length).toBeGreaterThan(200);
    expect(crewInsert).toMatch(/public\.payout_waits_on_identity\(g\.helper_id\)/);
    expect(crewInsert).toMatch(/NOT\s+public\.cancel_fee_payee_frozen\(g\.helper_id\)/);
    expect(crewInsert).toMatch(/ORDER BY g\.joined_at NULLS LAST, g\.id/);
    const ts = readFileSync("supabase/functions/_shared/crewCancelQuote.ts", "utf8");
    expect(ts).toContain('"payout_waits_on_identity"');
    expect(ts).toContain('"cancel_fee_payee_frozen"');
  });

  it("pure: a frozen member's share is 0 and the rest are on the ladder", () => {
    const m = (frozen = false, idWaits = false) => ({ share_cents: 10000, confirmed: true, idWaits, frozen });
    expect(crewCancelFeeCents([m(), m(true), m()], 300, 3, 6)).toEqual({ cents: 5000, percent: 25 });
    expect(crewCancelFeeCents([m(), m(false, true)], 200, 2, 1)).toEqual({ cents: 5000, percent: 50 });
    expect(crewCancelFeeCents([m(true), m(true)], 200, 2, 1)).toEqual({ cents: 0, percent: 0 });
  });
});

