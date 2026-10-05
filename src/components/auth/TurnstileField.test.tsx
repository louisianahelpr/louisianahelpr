/**
 * Q1314 — the Turnstile field's contract with the auth screens: a token when
 * Cloudflare gave one, `null` (never a hang) when it could not, a fresh
 * challenge after every attempt, and a visible Retry when the check failed.
 */
// @mutate src/components/auth/TurnstileField.tsx |             if (s === "off" \|\| s === "error") return null; |             if (s === "off") return null;
// @mutate src/components/auth/TurnstileField.tsx |             apiRef.current.reset(widgetRef.current); |             void 0;
// @mutate src/components/auth/TurnstileField.tsx |         {status === "error" && ( |         {status === "never" && (
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createRef } from "react";
import { render, screen } from "@testing-library/react";
import { TurnstileField, type TurnstileHandle } from "./TurnstileField";
import type { TurnstileRenderOptions } from "@/lib/turnstile";

let opts: TurnstileRenderOptions | null = null;
const api = {
  render: vi.fn((_el: HTMLElement, o: TurnstileRenderOptions) => {
    opts = o;
    return "w1";
  }),
  reset: vi.fn(),
  remove: vi.fn(),
};

beforeEach(() => {
  opts = null;
  api.render.mockClear();
  api.reset.mockClear();
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "test-site-key");
  window.turnstile = api;
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete window.turnstile;
});

async function mount() {
  const ref = createRef<TurnstileHandle>();
  render(<TurnstileField ref={ref} action="login" />);
  await act(async () => {});
  return ref;
}

describe("TurnstileField (Q1314)", () => {
  it("renders the widget invisibly, Managed interaction-only, with the site key", async () => {
    await mount();
    expect(api.render).toHaveBeenCalledTimes(1);
    expect(opts?.sitekey).toBe("test-site-key");
    expect(opts?.appearance).toBe("interaction-only");
  });

  it("getToken resolves the token Cloudflare issued, even when it arrives after the submit", async () => {
    const ref = await mount();
    const pending = ref.current!.getToken();
    act(() => opts!.callback("tok-1"));
    await expect(pending).resolves.toBe("tok-1");
  });

  it("reset() spends the token and asks Cloudflare for a fresh one", async () => {
    const ref = await mount();
    act(() => opts!.callback("tok-1"));
    act(() => ref.current!.reset());
    expect(api.reset).toHaveBeenCalledWith("w1");
    const pending = ref.current!.getToken();
    act(() => opts!.callback("tok-2"));
    await expect(pending).resolves.toBe("tok-2");
  });

  it("a failed check resolves null at once (never a hung submit) and shows Retry", async () => {
    const ref = await mount();
    act(() => {
      opts!["error-callback"]("110200");
    });
    const slow = new Promise((r) => setTimeout(() => r("still waiting"), 200));
    await expect(Promise.race([ref.current!.getToken(), slow])).resolves.toBeNull();
    expect(screen.getByText("The security check didn't load.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  it("renders nothing and resolves null when the site key is turned off", async () => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
    const ref = createRef<TurnstileHandle>();
    const { container } = render(<TurnstileField ref={ref} action="login" />);
    expect(container.innerHTML).toBe("");
    await expect(ref.current!.getToken()).resolves.toBeNull();
  });
});
