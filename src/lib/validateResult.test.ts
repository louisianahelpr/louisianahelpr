import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

// Mock @sentry/react before importing validateResult so the dynamic
// import inside captureDriftToSentry resolves to our spy.
const captureMessageMock = vi.fn();
vi.mock("@sentry/react", () => ({
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}));

// validateResult fires `void captureDriftToSentry(...)` which awaits a
// dynamic `import('@sentry/react')`. We need to wait until the spy has
// actually been called rather than racing the microtask queue — poll
// briefly so tests don't flake when the import resolves on a later tick.
async function waitForSentryCall(spy: { mock: { calls: unknown[][] } }) {
  for (let i = 0; i < 50; i++) {
    if (spy.mock.calls.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe("validateResult", () => {
  beforeEach(() => {
    captureMessageMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the parsed data unchanged when the payload matches the schema", async () => {
    const { validateResult } = await import("./validateResult");
    const schema = z.object({ id: z.string(), count: z.number() });
    const input = { id: "abc", count: 42 };
    const result = validateResult(schema, input, "test.valid");
    expect(result).toEqual(input);
    // Brief settle so any pending Sentry-import side effect would have
    // fired by the time we assert it didn't.
    await flushMicrotasks();
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it("logs schema drift to Sentry but still returns the raw payload", async () => {
    const { validateResult } = await import("./validateResult");
    const schema = z.object({ id: z.string(), count: z.number() });
    // count is a string instead of a number — a real schema-drift shape.
    const drifted = { id: "abc", count: "forty-two" };
    const result = validateResult(schema, drifted, "test.drifted");

    // The helper must NOT crash the screen — same raw payload comes
    // back so the consumer can keep rendering.
    expect(result).toBe(drifted);

    // Sentry receives a structured drift report with the context label
    // and the offending payload as extra.
    await waitForSentryCall(captureMessageMock);
    expect(captureMessageMock).toHaveBeenCalledOnce();
    const [message, options] = captureMessageMock.mock.calls[0] as [
      string,
      { level: string; extra: { issues: unknown; sample: unknown } },
    ];
    expect(message).toBe("Schema drift at test.drifted");
    expect(options.level).toBe("error");
    expect(options.extra.sample).toBe(drifted);
    expect(Array.isArray(options.extra.issues)).toBe(true);
    expect((options.extra.issues as unknown[]).length).toBeGreaterThan(0);
  });

  it("does not throw when Sentry itself fails — observability never breaks the caller", async () => {
    captureMessageMock.mockImplementation(() => {
      throw new Error("sentry SDK exploded");
    });
    const { validateResult } = await import("./validateResult");
    const schema = z.object({ id: z.string() });
    expect(() =>
      validateResult(schema, { id: 123 }, "test.sentry-fails"),
    ).not.toThrow();
  });

  it("includes the context label in the captured message verbatim", async () => {
    const { validateResult } = await import("./validateResult");
    const schema = z.object({ x: z.number() });
    validateResult(schema, { x: "not a number" }, "MyPage.useThing");
    await waitForSentryCall(captureMessageMock);
    const [message] = captureMessageMock.mock.calls[0] as [string, unknown];
    expect(message).toBe("Schema drift at MyPage.useThing");
  });
});
