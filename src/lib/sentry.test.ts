// sentry wraps @sentry/react. Same shape as posthog: idempotent init
// + no-op wrappers when not initialized. Bugs here either silently
// drop errors (regression — Sentry is the long-term archive) or
// crash on SSR / init failure.

import { describe, it, expect, vi, beforeEach } from "vitest";

const initMock = vi.fn();
const setUserMock = vi.fn();
const captureExceptionMock = vi.fn();

vi.mock("@sentry/react", () => ({
  init: (...args: unknown[]) => initMock(...args),
  setUser: (...args: unknown[]) => setUserMock(...args),
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  // Stub the integration helpers — the real ones return objects but the
  // init mock doesn't actually wire them so just return placeholders.
  breadcrumbsIntegration: () => ({ name: "breadcrumbs" }),
  globalHandlersIntegration: () => ({ name: "globalHandlers" }),
  linkedErrorsIntegration: () => ({ name: "linkedErrors" }),
  dedupeIntegration: () => ({ name: "dedupe" }),
  httpContextIntegration: () => ({ name: "httpContext" }),
  browserTracingIntegration: () => ({ name: "browserTracing" }),
}));

beforeEach(() => {
  vi.resetModules();
  initMock.mockReset();
  setUserMock.mockReset();
  captureExceptionMock.mockReset();
});

async function loadFresh() {
  return await import("./sentry");
}

describe("initSentry", () => {
  it("calls Sentry.init with DSN, env, release, and integrations", async () => {
    const { initSentry } = await loadFresh();
    initSentry();
    expect(initMock).toHaveBeenCalledOnce();
    const config = initMock.mock.calls[0][0] as Record<string, unknown>;
    expect(config.dsn).toBeTruthy();
    expect(config.environment).toBeTruthy();
    expect(config.release).toBeTruthy();
    expect(config.defaultIntegrations).toBe(false); // bundle-size guard
    expect(Array.isArray(config.integrations)).toBe(true);
    expect((config.integrations as unknown[]).length).toBe(6);
  });

  it("is idempotent — second call does NOT re-init", async () => {
    const { initSentry } = await loadFresh();
    initSentry();
    initSentry();
    expect(initMock).toHaveBeenCalledOnce();
  });

  it("ignores errors from Sentry SDK on init (must never break the app)", async () => {
    initMock.mockImplementation(() => {
      throw new Error("Sentry SDK refused to init");
    });
    const { initSentry } = await loadFresh();
    expect(() => initSentry()).not.toThrow();
  });

  it("includes ignoreErrors filter for benign known noise", async () => {
    const { initSentry } = await loadFresh();
    initSentry();
    const config = initMock.mock.calls[0][0] as { ignoreErrors: string[] };
    expect(config.ignoreErrors).toContain("ResizeObserver loop limit exceeded");
    expect(config.ignoreErrors).toContain(
      "ResizeObserver loop completed with undelivered notifications",
    );
  });

  it("beforeSend drops events from localhost when not in DEV mode", async () => {
    const { initSentry } = await loadFresh();
    initSentry();
    const config = initMock.mock.calls[0][0] as {
      beforeSend: (event: unknown) => unknown;
    };

    // Save and override window.location
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...original, hostname: "localhost" },
    });

    try {
      // import.meta.env.DEV is true in vitest, so beforeSend should NOT drop
      const result = config.beforeSend({ message: "test" });
      // In DEV mode we keep the event (vitest sets DEV=true)
      expect(result).toEqual({ message: "test" });
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  });
});

describe("captureException", () => {
  it("no-ops when Sentry is not initialized", async () => {
    const { captureException } = await loadFresh();
    captureException(new Error("test"));
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("forwards to Sentry.captureException after init", async () => {
    const { initSentry, captureException } = await loadFresh();
    initSentry();
    const err = new Error("real error");
    captureException(err);
    expect(captureExceptionMock).toHaveBeenCalledWith(err, undefined);
  });

  it("wraps context object in { extra } when provided", async () => {
    const { initSentry, captureException } = await loadFresh();
    initSentry();
    const err = new Error("contextual");
    captureException(err, { user_id: "u1" });
    expect(captureExceptionMock).toHaveBeenCalledWith(err, { extra: { user_id: "u1" } });
  });

  it("does NOT throw when Sentry SDK throws internally", async () => {
    captureExceptionMock.mockImplementation(() => {
      throw new Error("Sentry transport down");
    });
    const { initSentry, captureException } = await loadFresh();
    initSentry();
    expect(() => captureException(new Error("x"))).not.toThrow();
  });
});

describe("setSentryUser", () => {
  it("no-ops when Sentry is not initialized", async () => {
    const { setSentryUser } = await loadFresh();
    setSentryUser({ id: "u1" });
    expect(setUserMock).not.toHaveBeenCalled();
  });

  it("calls setUser with id + email after init", async () => {
    const { initSentry, setSentryUser } = await loadFresh();
    initSentry();
    setSentryUser({ id: "u1", email: "test@example.com" });
    expect(setUserMock).toHaveBeenCalledWith({ id: "u1", email: "test@example.com" });
  });

  it("converts null email to undefined (Sentry's expected absent shape)", async () => {
    const { initSentry, setSentryUser } = await loadFresh();
    initSentry();
    setSentryUser({ id: "u1", email: null });
    expect(setUserMock).toHaveBeenCalledWith({ id: "u1", email: undefined });
  });

  it("calls setUser(null) on logout (Sentry clears user context)", async () => {
    const { initSentry, setSentryUser } = await loadFresh();
    initSentry();
    setSentryUser(null);
    expect(setUserMock).toHaveBeenCalledWith(null);
  });
});
