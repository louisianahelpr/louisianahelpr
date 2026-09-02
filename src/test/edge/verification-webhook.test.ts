/**
 * Unit tests for the `verification-webhook` Supabase edge function — the
 * inbound callback for Checkr / Certificial / Stripe Identity results.
 *
 * The one invariant these cover is the idempotency ROLLBACK. Every delivery
 * writes a dedupe row before processing; when the handler then fails, the
 * function returns 500 to ask the vendor to redeliver and deletes that dedupe
 * row so the redelivery is not recognised as a duplicate. If the delete
 * silently removes nothing, the vendor's retry hits the dedupe wall, 200-skips,
 * and the verification status transition is stranded permanently — the exact
 * failure the rollback exists to prevent.
 *
 * A DELETE matching zero rows returns `{ data: [], error: null }`, so before
 * the fix that outcome was indistinguishable from success. These tests force
 * it and assert it is now loud.
 *
 * Runs the REAL function source via the edge harness; only Supabase, the Slack
 * alerter, and the Deno runtime are doubled. The Checkr HMAC is computed for
 * real, so signature verification runs unchanged.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { slackAlerts, resetSharedMocks } from "./mocks/shared";

const CHECKR_SECRET = "checkr_test_secret";

async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    CHECKR_WEBHOOK_SECRET: CHECKR_SECRET,
  });
  return loadEdgeFunction("verification-webhook");
}

/** A signed Checkr callback. The function HMACs the RAW bytes, so do the same. */
function checkrRequest(fn: EdgeHarness, payload: unknown) {
  const rawBody = JSON.stringify(payload);
  const signature = createHmac("sha256", CHECKR_SECRET).update(rawBody).digest("hex");
  return fn.request({
    rawBody,
    headers: {
      "x-vendor": "checkr",
      "x-checkr-signature": signature,
      "content-type": "application/json",
    },
  });
}

/** A "clear" report for a check the DB knows about. */
const CLEAR_REPORT = {
  id: "evt_checkr_1",
  data: { object: { id: "chk_abc", status: "clear" } },
};

function seedKnownCheck() {
  scenario.reads.verification_checks = {
    rows: [{ id: "vc-1", credential_id: "cred-1", user_id: "user-1" }],
  };
}

/**
 * Drive the function to a handler failure so the rollback runs: the
 * `verification_checks` UPDATE errors, which is one of the two paths that call
 * `rollbackIdempotency()` and return 500.
 */
async function runUpdateFailure(): Promise<Response> {
  const fn = await loadConfigured();
  seedKnownCheck();
  scenario.writeErrors.verification_checks = { message: "deadlock detected", code: "40P01" };
  return fn.fetch(checkrRequest(fn, CLEAR_REPORT));
}

function rollbackAlert() {
  return slackAlerts.find((a) =>
    String((a as { title?: string }).title ?? "").includes("rollback matched 0 rows"),
  ) as { severity?: string; fields?: Record<string, string> } | undefined;
}

describe("verification-webhook edge function", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
  });

  describe("signature verification", () => {
    it("rejects a Checkr callback whose HMAC does not match", async () => {
      const fn = await loadConfigured();
      const res = await fn.fetch(
        fn.request({
          rawBody: JSON.stringify(CLEAR_REPORT),
          headers: { "x-vendor": "checkr", "x-checkr-signature": "deadbeef" },
        }),
      );
      expect(res.status).toBe(401);
      // Nothing may be written before the signature is proven.
      expect(scenario.writes).toHaveLength(0);
    });
  });

  describe("idempotency rollback", () => {
    it("records the dedupe row, then rolls it back when the status update fails", async () => {
      const res = await runUpdateFailure();
      expect(res.status).toBe(500);

      const insert = scenario.writes.find(
        (w) => w.table === "stripe_webhook_events" && w.op === "insert",
      );
      const rollback = scenario.writes.find(
        (w) => w.table === "stripe_webhook_events" && w.op === "delete",
      );
      expect(insert).toBeDefined();
      expect(rollback).toBeDefined();
      // The rollback must target the SAME key the insert used, or it deletes
      // nothing and the vendor's retry 200-skips. (It was keyed on the raw
      // vendor event id while the insert used the hash-capable dedupeKey once
      // already.)
      expect(rollback?.filters).toEqual([
        { op: "eq", column: "event_id", value: (insert?.payload as { event_id: string }).event_id },
      ]);
    });

    it("pages ops when the rollback DELETE matches zero rows", async () => {
      scenario.writeSelectRows["stripe_webhook_events:delete"] = [];

      const res = await runUpdateFailure();
      expect(res.status).toBe(500);

      // BEFORE the fix: no alert, no log, nothing. The delete's result was
      // never inspected, so "removed nothing" and "removed the row" were the
      // same observable outcome — and the first one strands the verification
      // status transition forever.
      const alert = rollbackAlert();
      expect(alert).toBeDefined();
      expect(alert?.severity).toBe("critical");
      expect(alert?.["fields"]?.Vendor).toBe("checkr");
      expect(alert?.fields?.["Event ID"]).toBe("evt_checkr_1");
    });

    it("stays quiet when the rollback DELETE actually removes the row", async () => {
      scenario.writeSelectRows["stripe_webhook_events:delete"] = [
        { event_id: "checkr:evt_checkr_1" },
      ];

      const res = await runUpdateFailure();
      expect(res.status).toBe(500);
      // A working rollback must not page — a critical alert on every ordinary
      // handler failure is an alert that gets muted.
      expect(
        slackAlerts.filter((a) =>
          String((a as { title?: string }).title ?? "").includes("rollback"),
        ),
      ).toHaveLength(0);
    });

    it("asks the rollback DELETE for `event_id`, the only key this table has", async () => {
      // The mock resolves a write's `.select()` by table name and returns the
      // seeded rows regardless of projection, so the two tests above would pass
      // on `.select("id")` too. They must not: `stripe_webhook_events` is
      // `event_id TEXT PRIMARY KEY` with no `id` column — verified against prod
      // (`?select=id` → 400, `?select=event_id` → 200) — so `id` would make
      // every rollback a hard 400 and a permanent false "rollback FAILED" page.
      scenario.writeSelectRows["stripe_webhook_events:delete"] = [];
      await runUpdateFailure();

      const rollback = scenario.writes.find(
        (w) => w.table === "stripe_webhook_events" && w.op === "delete",
      );
      expect(rollback?.selectCols).toBe("event_id");
    });
  });
});
