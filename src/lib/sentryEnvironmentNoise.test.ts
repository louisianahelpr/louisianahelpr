/**
 * Sentry's own handlers (globalHandlersIntegration) catch unhandled rejections without going through report(), so
 * beforeSend must drop the environment's errors too (src/lib/clientNoise.ts; the weekly Sentry report for Nov 6-13
 * counted them). A real error still goes through (the floor).
 *
 * @mutate src/lib/sentry.ts |     if (isEnvironmentNoiseMessage(text)) return true; |
 */
import { describe, expect, it, vi } from "vitest";

const initMock = vi.fn();
vi.mock("@sentry/react", () => ({
  init: (...args: unknown[]) => initMock(...args),
  setUser: vi.fn(),
  setTag: vi.fn(),
  addBreadcrumb: vi.fn(),
  addIntegration: vi.fn(),
  getReplay: () => undefined,
  captureException: vi.fn(),
  breadcrumbsIntegration: () => ({}),
  globalHandlersIntegration: () => ({}),
  linkedErrorsIntegration: () => ({}),
  dedupeIntegration: () => ({}),
  httpContextIntegration: () => ({}),
  replayIntegration: () => ({}),
}));

import { initSentry } from "./sentry";

describe("Sentry beforeSend drops the environment's own errors", () => {
  initSentry();
  const beforeSend = (initMock.mock.calls[0]?.[0] as { beforeSend: (e: unknown) => unknown }).beforeSend;
  const asException = (value: string) => ({ exception: { values: [{ type: "Error", value }] } });

  it.each([
    "Object Not Found Matching Id:1, MethodName:update, ParamCount:4",
    "Error invoking postMessage: Java object is gone",
    "Failed to register a ServiceWorker for scope ('https://www.louisianahelpr.com/') with script ('https://www.louisianahelpr.com/sw.js'): Opera",
    "null is not an object (evaluating 't.themes')",
  ])("drops %s", (value) => {
    expect(beforeSend(asException(value))).toBeNull();
    expect(beforeSend({ message: value })).toBeNull();
  });

  it("keeps a real error (the floor)", () => {
    expect(beforeSend(asException("Cannot read properties of undefined (reading 'price_cents')"))).not.toBeNull();
  });
});
