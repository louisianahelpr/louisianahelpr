/**
 * Unit tests for the `stripe-idv-webhook` Supabase edge function — the inbound
 * callback for Stripe Identity verification sessions.
 *
 * Covers the idempotency ROLLBACK. Every delivery writes a dedupe row before
 * processing; when the handler then throws, the function returns 500 to ask
 * Stripe to redeliver and deletes that dedupe row so the redelivery is not
 * recognised as a duplicate. If the delete silently removes nothing, Stripe's
 * retry hits the dedupe wall, 200-skips, and the identity-verification status
 * transition (approval / manual review) is dropped for good.
 *
 * A DELETE matching zero rows returns `{ data: [], error: null }`, so before the
 * fix that outcome was indistinguishable from success. These tests force it and
 * assert it is now loud.
 *
 * Runs the REAL function source via the edge harness; only Stripe, Supabase,
 * the Slack alerter, and the Deno runtime are doubled.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { slackAlerts, resetSharedMocks } from "./mocks/shared";

async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_IDV_WEBHOOK_SECRET: "whsec_idv",
  });
  return loadEdgeFunction("stripe-idv-webhook");
}

function webhookRequest(fn: EdgeHarness) {
  return fn.request({
    rawBody: "{}",
    headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" },
  });
}

/**
 * Drive the function to a handler throw so the rollback runs: the `profiles`
 * UPDATE errors, which the source deliberately re-throws into the outer catch.
 * `processing` is the simplest event type — it needs no Stripe report fetch.
 */
async function runHandlerFailure(): Promise<Response> {
  const fn = await loadConfigured();
  stripeMock.webhooks.constructEventAsync.mockResolvedValue({
    id: "evt_idv_zero",
    type: "identity.verification_session.processing",
    data: { object: { id: "vs_1", metadata: { user_id: "user-1" } } },
  });
  scenario.writeErrors.profiles = { message: "deadlock detected", code: "40P01" };
  return fn.fetch(webhookRequest(fn));
}

function rollbackAlert() {
  return slackAlerts.find((a) =>
    String((a as { title?: string }).title ?? "").includes("rollback matched 0 rows"),
  ) as { severity?: string; fields?: Record<string, string> } | undefined;
}

describe("stripe-idv-webhook edge function", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  /**
   * SIGNATURE ENFORCEMENT.
   *
   * Added 2026-09-21 after this file was shown HOLLOW here: with the whole
   * rejection path replaced by "parse the body anyway"
   *   try { event = await stripe.webhooks.constructEventAsync(...) }
   *   catch { event = JSON.parse(body) as Stripe.Event }
   * all four existing tests still passed 4/4. Every one of them mocks
   * `constructEventAsync` to RESOLVE, so none of them ever reached the catch.
   * A forged POST could have driven `profiles.idv_status` to `verified` for any
   * user id it named, with no test noise at all.
   *
   * The two cases below are the ones that were missing: an unsigned request and
   * a request whose signature does not verify must both be refused BEFORE
   * anything is written — including the dedupe row, which is the first write the
   * function makes.
   */
  describe("signature enforcement", () => {
    /** A forged "this person is verified" payload, well-formed but unsigned. */
    const FORGED = JSON.stringify({
      id: "evt_forged",
      type: "identity.verification_session.verified",
      data: { object: { id: "vs_forged", metadata: { user_id: "victim-1" } } },
    });

    /*
     * Q156: refused with a non-2xx, never acknowledged, so a genuine event
     * whose secret is wrong is retried by Stripe instead of lost.
     *
     * @mutate supabase/functions/stripe-idv-webhook/index.ts | return webhookRejectResponse("signature_verification_failed", corsHeaders); | return new Response("{}", { status: 200 });
     * @mutate supabase/functions/stripe-idv-webhook/index.ts | return webhookRejectResponse("missing_signature_header", corsHeaders); | return new Response("{}", { status: 200 });
     * @mutate supabase/functions/stripe-idv-webhook/index.ts | await postSlackOpsAlert(\n      signatureFailureAlert({\n        fn: "stripe-idv-webhook", | void (\n      signatureFailureAlert({\n        fn: "stripe-idv-webhook",
     */
    it("refuses an unsigned POST and writes nothing", async () => {
      const fn = await loadConfigured();
      const res = await fn.fetch(
        fn.request({ rawBody: FORGED, headers: { "content-type": "application/json" } }),
      );
      // 400: Stripe signs every delivery, so this caller is not Stripe.
      expect(res.status).toBe(400);
      expect(JSON.parse(await res.text()).error).toBe("missing_signature_header");
      expect(stripeMock.webhooks.constructEventAsync).not.toHaveBeenCalled();
      expect(scenario.writes).toHaveLength(0);
    });

    it("refuses a payload whose signature does not verify, and writes nothing", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockRejectedValue(
        new Error("No signatures found matching the expected signature"),
      );
      const res = await fn.fetch(
        fn.request({
          rawBody: FORGED,
          headers: { "stripe-signature": "t=1,v1=forged", "content-type": "application/json" },
        }),
      );
      // 400, not 200: Stripe retries it, so fixing the secret recovers a real event.
      expect(res.status).toBe(400);
      expect(JSON.parse(await res.text()).error).toBe("signature_verification_failed");
      // The whole point: the forged body must NOT be parsed and processed. The
      // dedupe insert is the first write, so zero writes proves the function
      // stopped at the signature and never reached the handler.
      expect(scenario.writes).toHaveLength(0);
      const alert = slackAlerts.find((a) =>
        /signature failed/i.test(String((a as { title?: string }).title ?? "")),
      ) as { severity?: string } | undefined;
      expect(alert?.severity).toBe("critical");
    });
  });

  describe("idempotency rollback", () => {
    it("records the dedupe row, then rolls it back when processing throws", async () => {
      const res = await runHandlerFailure();
      expect(res.status).toBe(500);
      expect(JSON.parse(await res.text()).error).toBe("processing_error");

      const insert = scenario.writes.find(
        (w) => w.table === "stripe_webhook_events" && w.op === "insert",
      );
      const rollback = scenario.writes.find(
        (w) => w.table === "stripe_webhook_events" && w.op === "delete",
      );
      expect(insert).toBeDefined();
      expect(rollback?.filters).toEqual([
        { op: "eq", column: "event_id", value: "evt_idv_zero" },
      ]);
    });

    it("pages ops when the rollback DELETE matches zero rows", async () => {
      scenario.writeSelectRows["stripe_webhook_events:delete"] = [];

      const res = await runHandlerFailure();
      expect(res.status).toBe(500);

      // BEFORE the fix: no alert, no log. The delete's result was never
      // inspected, so a rollback that removed nothing looked exactly like one
      // that worked — and the row surviving strands the IDV transition.
      const alert = rollbackAlert();
      expect(alert).toBeDefined();
      expect(alert?.severity).toBe("critical");
      expect(alert?.fields?.["Event ID"]).toBe("evt_idv_zero");
    });

    it("stays quiet when the rollback DELETE actually removes the row", async () => {
      scenario.writeSelectRows["stripe_webhook_events:delete"] = [
        { event_id: "evt_idv_zero" },
      ];

      const res = await runHandlerFailure();
      expect(res.status).toBe(500);
      expect(
        slackAlerts.filter((a) =>
          String((a as { title?: string }).title ?? "").includes("rollback"),
        ),
      ).toHaveLength(0);
    });

    it("asks the rollback DELETE for `event_id`, the only key this table has", async () => {
      // The mock returns the seeded rows regardless of projection, so the tests
      // above would pass on `.select("id")` too. They must not:
      // `stripe_webhook_events` is `event_id TEXT PRIMARY KEY` with no `id`
      // column — verified against prod (`?select=id` → 400) — so `id` would turn
      // every rollback into a hard 400 and a permanent false-alarm page.
      scenario.writeSelectRows["stripe_webhook_events:delete"] = [];
      await runHandlerFailure();

      const rollback = scenario.writes.find(
        (w) => w.table === "stripe_webhook_events" && w.op === "delete",
      );
      expect(rollback?.selectCols).toBe("event_id");
    });
  });
});

// Proof this guard can fail (scripts/vacuity). This mutation keeps the happy
// path byte-identical (the mock resolves) and removes ONLY the refusal, so it
// isolates signature ENFORCEMENT rather than event shape. Before the
// "signature enforcement" block above it SURVIVED — 4/4 green with a forged
// payload processed as if Stripe had signed it.
// @mutate supabase/functions/stripe-idv-webhook/index.ts | event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret); | try { event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret); } catch { event = JSON.parse(body) as Stripe.Event; }
