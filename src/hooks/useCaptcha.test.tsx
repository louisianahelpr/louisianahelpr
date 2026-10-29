/**
 * A3-B1 (app audit 2026-10-29): Supabase Auth's captcha is OFF on purpose
 * (owner-approved 2026-10-15, Q2113), so a visible Turnstile box blocks
 * nothing, yet sign-up waited up to 45 s on it ("Creating account…" for 49 s,
 * measured by the audit). The rule: an email-auth call is never held on the
 * box; it waits for a tick only after the server has refused for captcha, and
 * then says "Tick the box to finish."
 *
 * Inventory: every screen that makes an email-auth call goes through
 * runWithCaptcha (useCaptcha().run or runWithCaptcha directly) and never calls
 * getToken itself, so none can bring the 45 s wait back on its own. The lead
 * capture (src/lib/signupLead.ts) is the one getToken caller outside it: it is
 * fire-and-forget and never blocks a screen.
 */
// @mutate src/components/auth/TurnstileField.tsx |               if (s === "interactive" && !waitForCheckbox) return null; |               void 0;
// @mutate src/hooks/useCaptcha.ts |   if (!widget \|\| !refusedForCaptcha(first)) return first; |   if (!widget) return first;
// @mutate src/hooks/useCaptcha.ts |   const fresh = await widget.getToken({ waitForCheckbox: true }); |   const fresh = await widget.getToken();
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createRef } from "react";
import { relative } from "node:path";
import { render, screen } from "@testing-library/react";
import { TurnstileField, type TurnstileHandle } from "@/components/auth/TurnstileField";
import type { TurnstileRenderOptions } from "@/lib/turnstile";
import { runWithCaptcha } from "./useCaptcha";
import { walkSource, readSource } from "@/test/helpers/walkSource";
import { blankComments } from "@/test/helpers/blankNonCode";

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
  vi.stubEnv("VITE_TURNSTILE_ENABLED", "true");
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "test-site-key");
  window.turnstile = api;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  delete window.turnstile;
});

async function mountWithBoxUp() {
  const ref = createRef<TurnstileHandle>();
  render(<TurnstileField ref={ref} action="signup" />);
  await act(async () => {});
  act(() => opts!["before-interactive-callback"]());
  return ref;
}

const REFUSED = { error: { message: "captcha protection: request disallowed (no captcha response)" } };

describe("an email-auth call is never held on the security box (A3-B1)", () => {
  it("server not enforcing: the call goes out at once, without a token, while a box is showing", async () => {
    const ref = await mountWithBoxUp();
    vi.useFakeTimers();
    const call = vi.fn(async (_t: string | undefined) => ({ error: null }));
    let done = false;
    void runWithCaptcha(ref.current, call).then(() => (done = true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(done, "the call waited on the box").toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(undefined);
    expect(screen.queryByText("Tick the box to finish.")).toBeNull();
  });

  it("server refuses for captcha: says to tick the box, waits for it, and sends once more with the token", async () => {
    const ref = await mountWithBoxUp();
    const call = vi.fn(async (t: string | undefined) => (t ? { error: null } : REFUSED));
    const pending = runWithCaptcha(ref.current, call);
    await act(async () => {});
    expect(screen.getByText("Tick the box to finish.")).toBeTruthy();
    act(() => opts!.callback("tok-after-tap"));
    await expect(pending).resolves.toEqual({ error: null });
    expect(call.mock.calls.map((c) => c[0])).toEqual([undefined, "tok-after-tap"]);
    expect(api.reset).toHaveBeenCalledTimes(1); // the spent token is re-armed
    expect(screen.queryByText("Tick the box to finish.")).toBeNull();
  });

  it("a token that is already there is still sent on the first try", async () => {
    const ref = createRef<TurnstileHandle>();
    render(<TurnstileField ref={ref} action="login" />);
    await act(async () => {});
    act(() => opts!.callback("tok-ready"));
    const call = vi.fn(async (_t: string | undefined) => ({ error: null }));
    await runWithCaptcha(ref.current, call);
    expect(call).toHaveBeenCalledWith("tok-ready");
  });

  it("every screen making an email-auth call goes through runWithCaptcha, none through getToken", () => {
    const GATED = /\.auth\s*\.\s*(signUp|signInWithPassword|signInWithOtp|resetPasswordForEmail|resend)\s*\(/;
    const screens = walkSource(["src"])
      .map((abs) => relative(process.cwd(), abs))
      .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$|(^|\/)test\//.test(f))
      .map((f) => ({ f, src: blankComments(readSource(f) ?? "") }))
      .filter(({ src }) => /<TurnstileField\b/.test(src));
    // Floor: Login, Signup, ForgotPassword, SignupPending, PasswordResetCard (2026-10-29).
    expect(screens.length).toBeGreaterThan(4);
    const bad = screens
      .filter(({ src }) => /\.getToken\s*\(/.test(src) || (GATED.test(src) || /signInWithTimeout\s*\(/.test(src)) && !/\b(runWithCaptcha|captcha\.run)\s*\(/.test(src))
      .map(({ f }) => f);
    expect(bad).toEqual([]);
  });
});
