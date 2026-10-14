/**
 * settleJobForward starts where the product starts: the Helpr ACCEPTS the offer.
 *
 * A hire (accept_application) is an offer until the Helpr taps Accept Job
 * (accept_job_offer, Q1180). Since 20261004001807 (Q1187) the database's
 * enforce_helper_award_gate refuses arrival, Done and disputes on an offer no
 * one accepted (`accept_required`). scripts/e2e/settleForward.mjs walked
 * straight to mark_helper_arrival, so every caller that hires and then settles
 * forward died there: e2e-journeys 38527058685, 04-money-outcomes
 * hire-settle-tip, "mark_helper_arrival …: HTTP 403 accept_required". The same
 * walk is the teardown of 02-marketplace and the prod-lifecycle sweeper, so an
 * unaccepted leftover could never be settled either.
 *
 * Driven against a fake backend that enforces the gate the way prod does.
 *
 * @mutate scripts/e2e/settleForward.mjs |   if (job.status === "accepted" && !job.helper_confirmed_at) { |   if (false) {
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { settleJobForward } from "../../scripts/e2e/settleForward.mjs";

const POSTER = "p0000000-0000-0000-0000-000000000001";
const HELPER = "h0000000-0000-0000-0000-000000000002";
const JOB = "j0000000-0000-0000-0000-000000000003";

function fakeBackend(confirmed: boolean) {
  const calls: string[] = [];
  const row: Record<string, unknown> = {
    id: JOB, title: "[E2E DO NOT ACCEPT] settle", stripe_session_id: "cs_test_abc", status: "accepted",
    payment_status: "escrow", customer_id: POSTER, helper_id: HELPER, is_seed: true,
    helper_confirmed_at: confirmed ? "2026-10-14T07:00:00Z" : null, helper_arrived_at: null,
    poster_confirmed_arrival_at: null, latitude: 30.4, longitude: -91.1, require_photo_proof: true,
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchFake = vi.fn(async (url: string, init?: { method?: string }) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    calls.push(`${method} ${u.pathname}`);
    if (method === "GET" && u.pathname === "/rest/v1/jobs") return json(200, [row]);
    if (u.pathname === "/rest/v1/rpc/accept_job_offer") {
      row.helper_confirmed_at = "2026-10-14T07:10:00Z";
      return json(200, { state: "accepted" });
    }
    if (u.pathname === "/rest/v1/rpc/mark_helper_arrival") {
      // enforce_helper_award_gate, as on prod.
      if (!row.helper_confirmed_at) return json(403, { code: "42501", message: "accept_required" });
      row.helper_arrived_at = "2026-10-14T07:11:00Z";
      row.status = "in_progress";
      return json(200, { arrival_recorded: true });
    }
    // The next door (the poster's arrival confirm): stop the walk here.
    return json(500, { message: "fake backend: walk stopped after arrival" });
  });
  return { calls, fetchFake };
}

const seats = { base: "https://fake.supabase.co", anon: "anon", posterToken: "pt", helperToken: "ht", posterId: POSTER, helperId: HELPER, jobId: JOB };

afterEach(() => vi.unstubAllGlobals());

describe("settleJobForward on a hired job", () => {
  it("accepts the offer as the Helpr before it marks the arrival", async () => {
    const { calls, fetchFake } = fakeBackend(false);
    vi.stubGlobal("fetch", fetchFake);
    await expect(settleJobForward(seats)).rejects.toThrow(/confirming arrival/);
    const accept = calls.indexOf("POST /rest/v1/rpc/accept_job_offer");
    const arrival = calls.indexOf("POST /rest/v1/rpc/mark_helper_arrival");
    expect(accept, `calls: ${calls.join(", ")}`).toBeGreaterThan(-1);
    expect(arrival).toBeGreaterThan(accept);
  });

  it("does not re-accept an offer the Helpr already accepted", async () => {
    const { calls, fetchFake } = fakeBackend(true);
    vi.stubGlobal("fetch", fetchFake);
    await expect(settleJobForward(seats)).rejects.toThrow(/confirming arrival/);
    expect(calls).not.toContain("POST /rest/v1/rpc/accept_job_offer");
    expect(calls).toContain("POST /rest/v1/rpc/mark_helper_arrival");
  });
});
