// posthog wraps the posthog-js client. The wrappers MUST no-op
// silently when not initialized — analytics must never break the app
// (e.g., during SSR, before init runs, or after it failed).

import { describe, it, expect, vi, beforeEach } from "vitest";

const initMock = vi.fn();
const captureMock = vi.fn();
const captureExceptionMock = vi.fn();
const identifyMock = vi.fn();
const resetMock = vi.fn();
const debugMock = vi.fn();

vi.mock("posthog-js", () => ({
  default: {
    init: (...args: unknown[]) => initMock(...args),
    capture: (...args: unknown[]) => captureMock(...args),
    captureException: (...args: unknown[]) => captureExceptionMock(...args),
    identify: (...args: unknown[]) => identifyMock(...args),
    reset: (...args: unknown[]) => resetMock(...args),
    debug: (...args: unknown[]) => debugMock(...args),
  },
}));

beforeEach(() => {
  vi.resetModules();
  initMock.mockReset();
  captureMock.mockReset();
  captureExceptionMock.mockReset();
  identifyMock.mockReset();
  resetMock.mockReset();
  debugMock.mockReset();
});

async function loadFresh() {
  return await import("./posthog");
}

describe("captureEvent", () => {
  it("no-ops when not initialized — captures nothing, no throw", async () => {
    const { captureEvent } = await loadFresh();
    expect(() => captureEvent("test_event", { foo: "bar" })).not.toThrow();
    expect(captureMock).not.toHaveBeenCalled();
  });

  it("forwards to posthog.capture after init", async () => {
    const { initPostHog, captureEvent } = await loadFresh();
    initPostHog();
    captureEvent("button_clicked", { button: "apply" });
    expect(captureMock).toHaveBeenCalledWith("button_clicked", { button: "apply" });
  });

  it("default empty props object when none provided", async () => {
    const { initPostHog, captureEvent } = await loadFresh();
    initPostHog();
    captureEvent("simple_event");
    expect(captureMock).toHaveBeenCalledWith("simple_event", {});
  });

  it("does not throw when posthog.capture throws internally", async () => {
    captureMock.mockImplementation(() => {
      throw new Error("posthog-js SDK error");
    });
    const { initPostHog, captureEvent } = await loadFresh();
    initPostHog();
    expect(() => captureEvent("test")).not.toThrow();
  });
});

describe("captureException", () => {
  it("no-ops before init", async () => {
    const { captureException } = await loadFresh();
    captureException(new Error("test"));
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("forwards Error instances directly", async () => {
    const { initPostHog, captureException } = await loadFresh();
    initPostHog();
    const err = new Error("real error");
    captureException(err, { ctx: "test" });
    expect(captureExceptionMock).toHaveBeenCalledWith(err, { ctx: "test" });
  });

  it("wraps non-Error values in Error before forwarding", async () => {
    const { initPostHog, captureException } = await loadFresh();
    initPostHog();
    captureException("string error message");
    const [arg] = captureExceptionMock.mock.calls[0];
    expect(arg).toBeInstanceOf(Error);
    expect((arg as Error).message).toBe("string error message");
  });

  it("does not throw when posthog throws internally", async () => {
    captureExceptionMock.mockImplementation(() => {
      throw new Error("SDK down");
    });
    const { initPostHog, captureException } = await loadFresh();
    initPostHog();
    expect(() => captureException(new Error("x"))).not.toThrow();
  });
});

describe("identifyUser + resetUser", () => {
  it("identifyUser no-ops before init", async () => {
    const { identifyUser } = await loadFresh();
    identifyUser("user-1");
    expect(identifyMock).not.toHaveBeenCalled();
  });

  it("identifyUser forwards userId + props after init", async () => {
    const { initPostHog, identifyUser } = await loadFresh();
    initPostHog();
    identifyUser("user-1", { plan: "elite" });
    expect(identifyMock).toHaveBeenCalledWith("user-1", { plan: "elite" });
  });

  it("resetUser no-ops before init", async () => {
    const { resetUser } = await loadFresh();
    resetUser();
    expect(resetMock).not.toHaveBeenCalled();
  });

  it("resetUser forwards to posthog.reset after init", async () => {
    const { initPostHog, resetUser } = await loadFresh();
    initPostHog();
    resetUser();
    expect(resetMock).toHaveBeenCalledOnce();
  });
});

describe("initPostHog", () => {
  it("calls posthog.init with the publishable key + correct config", async () => {
    const { initPostHog } = await loadFresh();
    initPostHog();
    expect(initMock).toHaveBeenCalledOnce();
    const [key, config] = initMock.mock.calls[0];
    expect(key).toMatch(/^phc_/);
    expect((config as Record<string, unknown>).person_profiles).toBe("identified_only");
    expect((config as Record<string, unknown>).capture_exceptions).toBe(false);
    expect((config as Record<string, unknown>).disable_session_recording).toBe(true);
    // Bundle-size guards: surveys + autocapture + external deps OFF
    expect((config as Record<string, unknown>).disable_surveys).toBe(true);
    expect((config as Record<string, unknown>).autocapture).toBe(false);
    expect((config as Record<string, unknown>).disable_external_dependency_loading).toBe(true);
  });

  it("is idempotent — second call does not re-init", async () => {
    const { initPostHog } = await loadFresh();
    initPostHog();
    initPostHog();
    expect(initMock).toHaveBeenCalledOnce();
  });

  it("swallows init errors without throwing (analytics must never break the app)", async () => {
    initMock.mockImplementation(() => {
      throw new Error("posthog init failed");
    });
    const { initPostHog } = await loadFresh();
    expect(() => initPostHog()).not.toThrow();
  });
});
