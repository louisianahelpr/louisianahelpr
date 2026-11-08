/**
 * The edge functions that write as the service role refuse a commitment from
 * a member who has not accepted the current Terms (owner 2026-11-08,
 * supabase/functions/_shared/requireCurrentTerms.ts). The table check
 * (tr_require_current_terms) cannot see the caller behind a service-role
 * write, so each function asks terms_accepted_is_current for the user it
 * verified, before any Stripe call.
 *
 *   E1 each gated action answers 403 { code: "terms_not_accepted" } and makes
 *      no Stripe call, when the member is behind;
 *   E2 a failed check answers 503 terms_check_failed (never terms_not_accepted,
 *      which would ask a member who already agreed);
 *   E3 a read action (instant-payout quote) is not checked.
 *
 * @mutate supabase/functions/_shared/requireCurrentTerms.ts |   if (data === true) return null; |   return null;
 * @mutate supabase/functions/_shared/requireCurrentTerms.ts |       return json({ error: TERMS_CHECK_FAILED_MESSAGE, code: "terms_check_failed" }, 503, headers);\n    }\n    data = res.data; |       return null;\n    }\n    data = res.data;
 * @mutate supabase/functions/instant-payout/index.ts |     if (action === "execute") {\n      const staleTerms |     if (action === "never") {\n      const staleTerms
 * @mutate supabase/functions/cash-out-credits/index.ts |     const staleTerms = await refuseStaleTerms(supabase, userData.user, corsHeaders); |     const staleTerms = null;
 */
import { beforeEach, describe, expect, it } from "vitest";
import { loadEdgeFunction } from "./harness";
import { resetEnv, setEnv } from "./mocks/deno-runtime";
import { resetSupabaseMock, scenario } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetStripeMock, stripeMock } from "./mocks/stripe";

const USER = { id: "member-1", email: "member@example.com" };

/** Function -> one gated request body. */
const GATED: Array<[string, Record<string, unknown>]> = [
  ["create-payment", { action: "escrow", jobId: "00000000-0000-4000-8000-000000000001" }],
  ["create-payment", { action: "capture_hold", jobId: "00000000-0000-4000-8000-000000000001" }],
  ["declutter-checkout", { action: "pay", itemId: "00000000-0000-4000-8000-000000000002" }],
  ["shop-checkout", { action: "order", shopId: "00000000-0000-4000-8000-000000000003" }],
  ["instant-payout", { action: "execute" }],
  ["cash-out-credits", { attemptId: "11111111-2222-4333-8444-555555555555" }],
];

async function call(name: string, body: Record<string, unknown>) {
  const fn = await loadEdgeFunction(name);
  const res = await fn.fetch(
    fn.request({ method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer caller.jwt.sig" }, body }),
  );
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { code?: string; error?: string } };
}

function stripeCalls(): number {
  let n = 0;
  for (const group of Object.values(stripeMock) as Array<Record<string, { mock?: { calls: unknown[] } }>>) {
    if (!group || typeof group !== "object") continue;
    for (const m of Object.values(group)) n += m?.mock?.calls.length ?? 0;
  }
  return n;
}

beforeEach(() => {
  resetEnv();
  resetSupabaseMock();
  resetSharedMocks();
  resetStripeMock();
  setEnv({
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    SECRET_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_terms",
    STRIPE_TEST_SECRET_KEY: "sk_test_terms",
  });
  scenario.authUser = USER;
});

describe("a member behind on the Terms is refused before any money moves", () => {
  it("covers every gated function (inventory floor)", () => {
    expect(new Set(GATED.map(([n]) => n)).size).toBeGreaterThan(4);
  });

  for (const [name, body] of GATED) {
    it(`E1 ${name} ${String(body.action ?? "(cash-out)")}: 403 terms_not_accepted, no Stripe call`, async () => {
      scenario.rpc.terms_accepted_is_current = false;
      const res = await call(name, body);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("terms_not_accepted");
      expect(stripeCalls()).toBe(0);
      expect(scenario.rpcCalls?.some((c) => c.name === "terms_accepted_is_current" && (c.args as { p_user_id?: string }).p_user_id === USER.id)).toBe(true);
    });

    it(`E2 ${name} ${String(body.action ?? "(cash-out)")}: a failed check is 503 terms_check_failed`, async () => {
      scenario.rpcErrors = { terms_accepted_is_current: { message: "connection reset" } };
      const res = await call(name, body);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("terms_check_failed");
      expect(stripeCalls()).toBe(0);
    });
  }

  it("E3 instant-payout quote (a read) is not checked", async () => {
    scenario.rpc.terms_accepted_is_current = false;
    await call("instant-payout", { action: "quote" });
    expect(scenario.rpcCalls?.some((c) => c.name === "terms_accepted_is_current")).toBe(false);
  });
});
