/**
 * CLASS GUARD: report()'s severity is the level Sentry records.
 *
 * Measured 2026-10-12 (Sentry helpr-4m): "Session lost on a signed-in screen"
 * (ProtectedRoute, report(..., { severity: "warning" })) and "ZIP 40560
 * resolved to no Louisiana parish" (parishLookup, a warning that "must not
 * page anyone") were stored by Sentry at level:error, because
 * fanOutToObservability passed only the context. The hourly ledger sync maps
 * Sentry's level to the ledger's severity (scripts/lib/sentryLedgerSync.mjs),
 * so every warning in the app arrived as an error alert (Q1604, Q1636).
 *
 * Inventory: every severity report() accepts.
 */
// @mutate src/lib/errorLogger.ts | captureException(err, extra, severity)) | captureException(err, extra))
import { beforeEach, describe, expect, it, vi } from "vitest";

const sentryCapture = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 201 })));
vi.mock("@/lib/sentry", () => ({ captureException: sentryCapture }));
vi.mock("@/lib/posthog", () => ({ captureException: vi.fn() }));

import { report } from "./errorLogger";

const SEVERITIES = ["info", "warning", "error", "fatal"] as const;

async function levelFor(opts: Parameters<typeof report>[1]): Promise<unknown> {
  sentryCapture.mockClear();
  report(new Error(`severity probe ${JSON.stringify(opts ?? null)}`), opts);
  await vi.waitFor(() => expect(sentryCapture).toHaveBeenCalled());
  return sentryCapture.mock.calls[0][2];
}

describe("report() severity reaches Sentry (2026-10-12)", () => {
  beforeEach(() => {
    sentryCapture.mockClear();
    // report() drops everything on localhost (the dev environment).
    Object.defineProperty(window, "location", { value: new URL("https://www.louisianahelpr.com/home"), writable: true });
  });

  it("covers every severity report() takes (inventory floor)", () => {
    expect(SEVERITIES.length).toBeGreaterThan(3);
  });

  for (const severity of SEVERITIES) {
    it(`a ${severity} report is sent to Sentry at level ${severity}`, async () => {
      expect(await levelFor({ severity })).toBe(severity);
    });
  }

  it("a report with no severity is an error, as error_logs records it", async () => {
    expect(await levelFor(undefined)).toBe("error");
  });
});

