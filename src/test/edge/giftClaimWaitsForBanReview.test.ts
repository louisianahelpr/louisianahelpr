/**
 * Q1415 (c), owner 11-03 ("HOLD THOSE TOO"): an account under an OPEN ban settlement review claims no gift card
 * until the review is decided, like its payouts (_shared/banReview.ts loadBanReviewUsers). The gift stays unclaimed
 * (no gift_cards write); an unreadable review fails closed (503, nothing bound); an account not under review claims
 * as before.
 *
 * @mutate supabase/functions/claim-gift-card/index.ts |     if (review.users.has(user.id)) { |     if (false) {
 * @mutate supabase/functions/claim-gift-card/index.ts |     if (!review.ok) { |     if (false) {
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const AUTH = { Authorization: "Bearer test-jwt" };
const MEMBER = "44444444-4444-4444-8444-444444444444";
const EMAIL = "real.person@example.com";

async function claim() {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_live_real_money",
  });
  scenario.authUser = { id: MEMBER, email: EMAIL };
  scenario.reads.gift_cards = {
    rows: [{ id: "gift_1", recipient_id: null, recipient_email: EMAIL, status: "sent", expires_at: null, payment_status: "paid", stripe_session_id: "cs_live_gift" }],
  };
  const fn = await loadEdgeFunction("claim-gift-card");
  const res = await fn.fetch(fn.request({ headers: AUTH, body: { claim_token: "tok" } }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const bound = () => scenario.writes.some((w) => w.table === "gift_cards" && w.op === "update");

describe("a gift claim waits for an open ban review (Q1415 c)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });
  afterEach(() => resetEnv());

  it("an account under an open review is refused (409) and nothing is bound", async () => {
    scenario.reads.ban_settlement_queue = { rows: [{ user_id: MEMBER }] };
    const { status, body } = await claim();
    expect(status).toBe(409);
    expect(body).toMatchObject({ code: "account_under_review" });
    expect(bound()).toBe(false);
  });

  it("an unreadable review fails closed (503) and nothing is bound", async () => {
    scenario.reads.ban_settlement_queue = { error: { message: "connection reset" } };
    const { status } = await claim();
    expect(status).toBe(503);
    expect(bound()).toBe(false);
  });

  it("an account not under review claims as before", async () => {
    scenario.reads.ban_settlement_queue = { rows: [] };
    const { status } = await claim();
    expect(status).toBe(200);
    expect(bound()).toBe(true);
  });
});
