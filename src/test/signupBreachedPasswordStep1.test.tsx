/**
 * signup-submit 11-23 (owner report, a real sign-up on iPad Safari): "when he clicks sign up after filling everything
 * out it does nothing. Just makes him keep filling out the forms." Prod logs: record-signup-lead (step 1's Continue)
 * three times in 84 s, and no POST to /auth/v1/signup at all.
 *
 * The one path that reaches step 2 and returns before signUp without a step-2 field error is the breached-password
 * check (HIBP): it showed a corner toast on step 2, a screen with no password field, and stayed there. Reproduced in
 * Playwright WebKit at iPad 820x1180 on a local preview build with every network call mocked: 0 signUp, toast at the
 * bottom right, still on step 2. Now step 1 opens with the reason under the password field, focused, and Continue
 * waits for a new password.
 *
 * Driven for real: the route wrapper App.tsx uses and the whole Signup page. Only the network (supabase-js, HIBP) and
 * toasts are stubbed.
 *
 * @mutate src/pages/auth/Signup.tsx |         setServerPasswordError(t("signup.passwordPwned", { count: pwnedCount.toLocaleString() })); |         toast.error(t("signup.passwordPwned", { count: pwnedCount.toLocaleString() }));
 * @mutate src/pages/auth/Signup.tsx |         backToStep1();\n        setLoading(false); |         setLoading(false);
 * @mutate src/pages/auth/signup/SignupStep1.tsx |     if (!passwordValid \|\| serverPasswordError) { |     if (!passwordValid) {
 * @mutate src/pages/auth/signup/SignupStep1.tsx |     passwordRef.current?.focus();\n    passwordRef.current?.scrollIntoView | void 0;\n    passwordRef.current?.scrollIntoView
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const h = vi.hoisted(() => {
  const signUps: string[] = [];
  const pwned = { count: 0 as number | null };
  function chain(): unknown {
    const result = { data: [], error: null, count: 0 };
    const proxy: unknown = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
        if (prop === "single" || prop === "maybeSingle") return () => Promise.resolve({ data: null, error: null });
        if (typeof prop === "symbol") return undefined;
        return () => proxy;
      },
    });
    return proxy;
  }
  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signUp: async (args: { password: string }) => {
        signUps.push(args.password);
        return { data: { user: { id: "10000000-0000-4000-8000-0000000000dd" }, session: null }, error: null };
      },
    },
    from: () => chain(),
    rpc: async () => ({ data: null, error: null }),
    functions: { invoke: async () => ({ data: { success: true, referralRecorded: false }, error: null }) },
    storage: { from: () => ({ upload: async () => ({ data: { path: "p" }, error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
    channel: () => { const ch = { on: () => ch, subscribe: () => ch, unsubscribe: () => {} }; return ch; },
    removeChannel: () => {},
  };
  return { signUps, pwned, supabase };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));
vi.mock("@/lib/hibpCheck", () => ({ checkPasswordPwned: async () => h.pwned.count }));
vi.mock("@/lib/posthog", () => ({ captureEvent: vi.fn(), initPostHog: vi.fn() }));
vi.mock("@/lib/restInsert", () => ({ postRows: async () => 201 }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
  Toaster: () => null,
}));

import { RoutePageTransition } from "@/components/RoutePageTransition";
import Signup from "@/pages/auth/Signup";
import { clearPendingSignup } from "@/lib/pendingSignup";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  clearPendingSignup();
  h.signUps.length = 0;
  h.pwned.count = 0;
});

const BREACHED = "Password1234!";
const FRESH = "Str0ng!Passw0rd#";

function renderSignup() {
  render(
    <MemoryRouter initialEntries={["/signup"]}>
      <Routes>
        <Route path="/signup" element={<RoutePageTransition><Signup /></RoutePageTransition>} />
        <Route path="/signup-pending" element={<div>pending</div>} />
      </Routes>
    </MemoryRouter>,
  );
}
const passwordField = () => document.getElementById("password") as HTMLInputElement | null;
const createButton = () => screen.queryByRole("button", { name: /^create account$/i });

async function fillStep1AndContinue(password: string) {
  fireEvent.change(document.getElementById("firstName")!, { target: { value: "Bree" } });
  fireEvent.change(document.getElementById("lastName")!, { target: { value: "Ched" } });
  fireEvent.change(document.getElementById("email")!, { target: { value: "breached.test@example.com" } });
  fireEvent.change(passwordField()!, { target: { value: password } });
  fireEvent.click(document.getElementById("policies")!);
  fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
  await screen.findByRole("button", { name: /^create account$/i }, { timeout: 4000 });
}

describe("a breached password on Create account lands on step 1's password field", () => {
  it("goes back to step 1 with the reason under the focused field, holds Continue, and a new password signs up", async () => {
    h.pwned.count = 3861493;
    renderSignup();
    await fillStep1AndContinue(BREACHED);
    fireEvent.click(createButton()!);

    // Step 1 again, the password kept, the reason under it, the field focused. No account call was made.
    await waitFor(() => expect(passwordField()).not.toBeNull(), { timeout: 4000 });
    const field = passwordField()!;
    expect(field.value).toBe(BREACHED);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById("signup-password-error")?.textContent).toContain("3,861,493 known data breaches");
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(h.signUps).toHaveLength(0);

    // Continue with the same refused password stays here (it would only be refused again after step 2).
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(createButton()).toBeNull();

    // A new password clears the reason and the sign-up goes through.
    h.pwned.count = 0;
    fireEvent.change(field, { target: { value: FRESH } });
    expect(document.getElementById("signup-password-error")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    await screen.findByRole("button", { name: /^create account$/i }, { timeout: 4000 });
    fireEvent.click(createButton()!);
    await waitFor(() => expect(h.signUps).toEqual([FRESH]), { timeout: 4000 });
  });
});
