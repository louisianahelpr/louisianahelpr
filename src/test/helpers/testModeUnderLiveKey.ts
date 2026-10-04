import { vi } from "vitest";

/**
 * The exact error Stripe's live key throws for an id minted in test mode
 * (function_logs 2026-09-30T15:55:34Z, create-payment cancel_escrow, job
 * 36eebad4). Every job funded before prod went live (2026-09-27) holds one.
 * Note statusCode 404 / code resource_missing: the same shape as a plain
 * missing object, which is why every caller must classify it FIRST.
 */
export function testModeUnderLiveKey(kind: string, id: string) {
  return Object.assign(
    new Error(`No such ${kind}: '${id}'; a similar object exists in test mode, but a live mode key was used to make this request.`),
    { type: "StripeInvalidRequestError", code: "resource_missing", statusCode: 404 },
  );
}

/**
 * Spy on console.log and return the structured `stripe_test_object_under_live_key`
 * lines (parsed) the function wrote. Call `restore()` in afterEach.
 */
export function captureTestModeSkips() {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  return {
    lines: (): Array<Record<string, unknown>> =>
      spy.mock.calls
        .map((c) => String(c[0]))
        .filter((s) => s.startsWith("{") && s.includes("stripe_test_object_under_live_key"))
        .map((s) => JSON.parse(s)),
    restore: () => spy.mockRestore(),
  };
}
