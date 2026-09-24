// sentry wraps @sentry/react. Same shape as posthog: idempotent init
// + no-op wrappers when not initialized. Bugs here either silently
// drop errors (regression — Sentry is the long-term archive) or
// crash on SSR / init failure.

import { describe, it, expect, vi, beforeEach } from "vitest";

const initMock = vi.fn();
const setUserMock = vi.fn();
const captureExceptionMock = vi.fn();
const addIntegrationMock = vi.fn();
const setTagMock = vi.fn();

vi.mock("@sentry/react", () => ({
  init: (...args: unknown[]) => initMock(...args),
  setUser: (...args: unknown[]) => setUserMock(...args),
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  // addIntegration is used to register Session Replay on an idle tick
  // *after* init() returns (cold-start perf — keeps Replay's ~38KB parse
  // off the critical bundle-eval path). In DEV (vitest) the deferred
  // block is gated behind import.meta.env.PROD so this stays unused,
  // but the symbol must exist for the named import to resolve.
  addIntegration: (...args: unknown[]) => addIntegrationMock(...args),
  setTag: (...args: unknown[]) => setTagMock(...args),
  // Stub the integration helpers — the real ones return objects but the
  // init mock doesn't actually wire them so just return placeholders.
  breadcrumbsIntegration: () => ({ name: "breadcrumbs" }),
  globalHandlersIntegration: () => ({ name: "globalHandlers" }),
  linkedErrorsIntegration: () => ({ name: "linkedErrors" }),
  dedupeIntegration: () => ({ name: "dedupe" }),
  httpContextIntegration: () => ({ name: "httpContext" }),
  // Replay only registers in prod builds; vitest runs in DEV mode so
  // initSentry() won't actually invoke this — but the symbol must
  // exist for the named import to resolve.
  replayIntegration: (opts: unknown) => ({ name: "replay", opts }),
}));

beforeEach(() => {
  vi.resetModules();
  initMock.mockReset();
  setUserMock.mockReset();
  captureExceptionMock.mockReset();
  addIntegrationMock.mockReset();
  setTagMock.mockReset();
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
    expect((config.integrations as unknown[]).length).toBe(5);
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

describe("isLocalBuildHost (Q296)", () => {
  it("drops a prod build served locally over http", async () => {
    const { isLocalBuildHost } = await loadFresh();
    expect(isLocalBuildHost({ protocol: "http:", hostname: "127.0.0.1" })).toBe(true);
    expect(isLocalBuildHost({ protocol: "http:", hostname: "localhost" })).toBe(true);
  });
  it("never drops the native apps (iOS capacitor://localhost, Android https://localhost)", async () => {
    const { isLocalBuildHost } = await loadFresh();
    expect(isLocalBuildHost({ protocol: "capacitor:", hostname: "localhost" })).toBe(false);
    expect(isLocalBuildHost({ protocol: "https:", hostname: "localhost" })).toBe(false);
  });
  it("never drops the web app", async () => {
    const { isLocalBuildHost } = await loadFresh();
    expect(isLocalBuildHost({ protocol: "https:", hostname: "www.louisianahelpr.com" })).toBe(false);
  });
});

describe("beforeSend noise filter", () => {
  async function getBeforeSend() {
    const { initSentry } = await loadFresh();
    initSentry();
    const config = initMock.mock.calls[0][0] as {
      beforeSend: (event: unknown) => unknown;
    };
    return config.beforeSend;
  }

  it("drops network blip errors (Load failed, Failed to fetch, AbortError)", async () => {
    const beforeSend = await getBeforeSend();
    const cases = [
      { message: "TypeError: Load failed" },
      { exception: { values: [{ value: "TypeError: Failed to fetch" }] } },
      {
        exception: {
          values: [{ value: "NetworkError when attempting to fetch resource." }],
        },
      },
      { exception: { values: [{ value: "AbortError: The user aborted a request." }] } },
    ];
    for (const event of cases) {
      expect(beforeSend(event)).toBeNull();
    }
  });

  it("drops browser-extension errors via stack frame URLs", async () => {
    const beforeSend = await getBeforeSend();
    const event = {
      exception: {
        values: [
          {
            value: "Cannot read properties of undefined (reading 'foo')",
            stacktrace: {
              frames: [
                { filename: "chrome-extension://abcdef/content.js" },
                { filename: "https://app.louisianahelpr.com/index.js" },
              ],
            },
          },
        ],
      },
    };
    expect(beforeSend(event)).toBeNull();
  });

  it("drops quota/storage errors common in private mode", async () => {
    const beforeSend = await getBeforeSend();
    expect(beforeSend({ message: "QuotaExceededError" })).toBeNull();
    expect(
      beforeSend({
        exception: { values: [{ value: "DOMException: The operation is insecure." }] },
      }),
    ).toBeNull();
  });

  it("drops Capacitor 'not available on this platform' plugin errors", async () => {
    const beforeSend = await getBeforeSend();
    expect(
      beforeSend({
        exception: {
          values: [{ value: "Haptics is not available on this platform." }],
        },
      }),
    ).toBeNull();
  });

  it("drops AuthSessionMissingError (expected control flow)", async () => {
    const beforeSend = await getBeforeSend();
    expect(
      beforeSend({
        exception: { values: [{ value: "AuthSessionMissingError: Auth session missing!" }] },
      }),
    ).toBeNull();
  });

  it("drops ResizeObserver loop warnings", async () => {
    const beforeSend = await getBeforeSend();
    expect(
      beforeSend({ message: "ResizeObserver loop completed with undelivered notifications" }),
    ).toBeNull();
  });

  it("keeps real application errors", async () => {
    const beforeSend = await getBeforeSend();
    const event = {
      exception: {
        values: [
          {
            value: "TypeError: Cannot read properties of null (reading 'id')",
            stacktrace: {
              frames: [{ filename: "https://app.louisianahelpr.com/assets/index.js" }],
            },
          },
        ],
      },
    };
    expect(beforeSend(event)).toEqual(event);
  });

  it("keeps events with no message and no exception value", async () => {
    const beforeSend = await getBeforeSend();
    const event = { exception: { values: [{}] } };
    expect(beforeSend(event)).toEqual(event);
  });
});

/**
 * SESSION REPLAY PII SCRUBBING — the one part of this module that can leak a
 * card number, and until 2026-09-21 the one part with no test at all.
 *
 * `maskAllText: true` lives inside `if (import.meta.env.PROD)`, and vitest runs
 * in DEV, so the whole deferred block was unreachable from this file: the flag
 * could be deleted, flipped to false, or the option renamed, and every test
 * here stayed green while prod Session Replay started recording the text of
 * every input on the screen — Stripe card numbers and CVCs, Supabase
 * magic-link tokens, message bodies.
 *
 * So PROD is stubbed on `import.meta.env` (vitest leaves it a plain mutable
 * object, unlike a real Vite build where it is statically replaced) and the
 * idle callback is driven synchronously, which makes the registration and its
 * privacy options observable.
 */
describe("Session Replay privacy (PROD path)", () => {
  async function initInProd() {
    const env = import.meta.env as unknown as Record<string, unknown>;
    const prevProd = env.PROD;
    const prevDev = env.DEV;
    env.PROD = true;
    env.DEV = false;
    // requestIdleCallback doesn't exist in jsdom; define it as an immediate
    // call so the deferred registration runs without timer gymnastics.
    const idle = vi.fn((cb: () => void) => {
      cb();
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", idle);
    try {
      const { initSentry } = await loadFresh();
      initSentry();
      // The registration is behind a dynamic `import("@sentry/react")`, so the
      // addIntegration call lands a microtask later.
      await vi.waitFor(() => expect(addIntegrationMock).toHaveBeenCalledOnce());
      return { idle };
    } finally {
      env.PROD = prevProd;
      env.DEV = prevDev;
      vi.unstubAllGlobals();
    }
  }

  it("registers Replay with maskAllText — every text node redacted", async () => {
    await initInProd();
    const integration = addIntegrationMock.mock.calls[0][0] as {
      name: string;
      opts: { maskAllText?: boolean; blockAllMedia?: boolean };
    };
    expect(integration.name).toBe("replay");
    // THE PCI LINE. Not `toBeTruthy()` — the option has to be exactly true,
    // and it has to be present: an absent key is Sentry's default of `true`
    // today but is not a decision this app has made.
    expect(integration.opts).toHaveProperty("maskAllText", true);
    // Media stays visible on purpose — images/icons carry no typed secrets
    // and a fully blocked replay is unreadable for debugging the UI.
    expect(integration.opts).toHaveProperty("blockAllMedia", false);
  });

  it("samples replay only as configured, and never breaks init", async () => {
    await initInProd();
    const config = initMock.mock.calls[0][0] as Record<string, unknown>;
    // Set on the initial config so the sampling decision is in force before
    // the deferred integration starts capturing.
    expect(config.replaysSessionSampleRate).toBe(0.1);
    expect(config.replaysOnErrorSampleRate).toBe(1.0);
  });

  it("a Replay registration that throws must not break the app", async () => {
    addIntegrationMock.mockImplementation(() => {
      throw new Error("replay refused to register");
    });
    await expect(initInProd()).resolves.toBeTruthy();
  });

  it("does NOT register Replay in a dev build", async () => {
    // The other side of the same gate: vitest is DEV, so nothing defers.
    const { initSentry } = await loadFresh();
    initSentry();
    await new Promise((r) => setTimeout(r, 0));
    expect(addIntegrationMock).not.toHaveBeenCalled();
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

  // Q32 / PR #1639: a Supabase PostgrestError is a plain object. Sentry titles
  // it "Object captured as exception with keys: ..." and beforeSend's benign
  // filter cannot see its message.
  // @mutate src/lib/sentry.ts | sentryCaptureException(normalizeToError(err), | sentryCaptureException(err,
  it("passes Error instances through unchanged", async () => {
    const { initSentry, captureException } = await loadFresh();
    initSentry();
    const err = new Error("real error");
    captureException(err);
    expect(captureExceptionMock.mock.calls[0][0]).toBe(err);
  });

  it("normalizes a plain Supabase error object to an Error carrying its message and the original as cause", async () => {
    const { initSentry, captureException } = await loadFresh();
    initSentry();
    const supabaseError = {
      code: "",
      details: "TypeError: Failed to fetch",
      hint: "",
      message: "TypeError: Failed to fetch (fncmgoasalhdgfwzhsqa.supabase.co)",
    };
    captureException(supabaseError);
    const calledWith = captureExceptionMock.mock.calls[0][0] as unknown;
    expect(calledWith).toBeInstanceOf(Error);
    expect((calledWith as Error).message).toBe("TypeError: Failed to fetch (fncmgoasalhdgfwzhsqa.supabase.co)");
    expect((calledWith as Error & { cause?: unknown }).cause).toBe(supabaseError);
  });

  it("normalizes a message-less object, even a circular one, without throwing", async () => {
    const { initSentry, captureException } = await loadFresh();
    initSentry();
    const circular: Record<string, unknown> = { code: "42501" };
    circular.self = circular;
    captureException(circular);
    const calledWith = captureExceptionMock.mock.calls[0][0] as Error & { cause?: unknown };
    expect(calledWith).toBeInstanceOf(Error);
    expect(calledWith.cause).toBe(circular);
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

// Proof this guard can fail, on the two lines that matter most here:
//  1. PII scrubbing. maskAllText false = prod Session Replay records the text of
//     every input — Stripe card numbers and CVCs, magic-link tokens.
//  2. The noise filter going universal. Returning true for every message makes
//     beforeSend drop EVERY error, i.e. the observability layer goes dark while
//     Sentry still reports as configured.
// @mutate src/lib/sentry.ts | maskAllText: true, | maskAllText: false,
// @mutate src/lib/sentry.ts | if (pattern.test(text)) return true; | return true;

// Q275: automation spent the Sentry replay quota. MEASURED 2026-09-23 (30 days):
// 39 of 63 replays carried a Playwright build signature (Chrome 151.0.7922 =
// Playwright 1.62's Chromium; Mobile Safari 16.0/26.5 = its iPhone
// descriptors), and none were recorded after 2026-09-14 ("Replay Quota
// Exceeded"). An automated browser (navigator.webdriver) records no replay in a
// PROD build; a person's browser still does. Errors still report, tagged.
// @mutate src/lib/sentry.ts |     const recordReplays = import.meta.env.PROD && !automated; |     const recordReplays = import.meta.env.PROD;
// @mutate src/lib/automatedBrowser.ts |     return typeof navigator !== "undefined" && navigator.webdriver === true; |     return false;
// @mutate src/lib/sentry.ts |     if (recordReplays) { |     if (import.meta.env.PROD) {
describe("Session Replay in automated browsers (Q275)", () => {
  async function initProd(webdriver: boolean) {
    vi.stubEnv("PROD", true);
    vi.stubEnv("DEV", false);
    // jsdom's navigator has no `webdriver`; define it for this case only.
    Object.defineProperty(navigator, "webdriver", { configurable: true, get: () => webdriver });
    vi.useFakeTimers();
    try {
      const { initSentry } = await loadFresh();
      initSentry();
      await vi.advanceTimersByTimeAsync(6_000);
      // the deferred registration is a dynamic import: let it settle
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 50));
      return initMock.mock.calls[0][0] as { replaysSessionSampleRate: number; replaysOnErrorSampleRate: number };
    } finally {
      vi.useRealTimers();
      delete (navigator as { webdriver?: boolean }).webdriver;
      vi.unstubAllEnvs();
    }
  }

  it("a person's browser in a PROD build samples and registers Replay", async () => {
    const config = await initProd(false);
    expect(config.replaysSessionSampleRate).toBeGreaterThan(0);
    expect(config.replaysOnErrorSampleRate).toBe(1);
    const names = addIntegrationMock.mock.calls.map((c) => (c[0] as { name?: string })?.name);
    expect(names).toContain("replay");
    expect(setTagMock).toHaveBeenCalledWith("automated", "false");
  });

  it("an automated browser (navigator.webdriver) records no replay at all, but still reports errors tagged", async () => {
    const config = await initProd(true);
    expect(initMock).toHaveBeenCalledOnce();
    expect(config.replaysSessionSampleRate).toBe(0);
    expect(config.replaysOnErrorSampleRate).toBe(0);
    expect(addIntegrationMock).not.toHaveBeenCalled();
    expect(setTagMock).toHaveBeenCalledWith("automated", "true");
  });
});
