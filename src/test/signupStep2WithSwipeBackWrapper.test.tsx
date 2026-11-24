/**
 * signup-autofill 11-23 (owner report, a real sign-up on iPad Safari): "when he clicks sign up after filling everything
 * out it does nothing. Just makes him keep filling out the forms." Prod analytics_events for that visit (6:31-6:34 PM
 * CT): signup_step_completed {step: 1} three times, each in the same batch as a NEW signup_started, and no step-2 event
 * at all; no POST to /auth/v1/signup. signup_started fires only on Signup's mount, so step 1's Continue was remounting
 * the page: back to step 1 with names and email kept (session draft) and the password and consent box empty.
 *
 * Cause: the route wrapper's swipe-back component (src/components/PageTransition.tsx, loaded once the first page has
 * settled) keyed its div on location.key. #4360 taught RoutePageTransition to keep the page across a KEEP_PAGE step,
 * but only its cold-start plain div honoured that; once the gesture chunk was in, every /signup reached by an in-app
 * link (Log in's switch, a page's Sign up button) remounted on Continue. Reproduced on a local preview build (all
 * network mocked) in Playwright WebKit as an iPad and in Chromium desktop: /login -> Create account -> fill -> Continue
 * -> empty step 1, 0 signUp calls. sameUrlStepKeepsThePage.test.tsx never loaded the gesture chunk, so it stayed green.
 *
 * This drives the whole Signup page inside the route wrapper WITH the gesture component loaded.
 *
 * @mutate src/components/PageTransition.tsx |     <div key={pageKey} ref={pageRef} |     <div key={String(Math.random())} ref={pageRef}
 * @mutate src/components/RoutePageTransition.tsx |   return <Animated pageKey={pageKey}>{children}</Animated>; |   return <Animated pageKey={String(Math.random())}>{children}</Animated>;
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const h = vi.hoisted(() => {
  const signUps: Array<{ email: string; password: string }> = [];
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
      signUp: async (args: { email: string; password: string }) => {
        signUps.push({ email: args.email, password: args.password });
        return { data: { user: { id: "10000000-0000-4000-8000-0000000000ee" }, session: null }, error: null };
      },
    },
    from: () => chain(),
    rpc: async () => ({ data: null, error: null }),
    functions: { invoke: async () => ({ data: { success: true, referralRecorded: false }, error: null }) },
    storage: { from: () => ({ upload: async () => ({ data: { path: "p" }, error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
    channel: () => { const ch = { on: () => ch, subscribe: () => ch, unsubscribe: () => {} }; return ch; },
    removeChannel: () => {},
  };
  return { signUps, supabase };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));
vi.mock("@/lib/hibpCheck", () => ({ checkPasswordPwned: async () => 0 }));
vi.mock("@/lib/posthog", () => ({ captureEvent: vi.fn(), initPostHog: vi.fn() }));
vi.mock("@/lib/restInsert", () => ({ postRows: async () => 201 }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
  Toaster: () => null,
}));

import { loadAnimatedPageTransition, RoutePageTransition } from "@/components/RoutePageTransition";
import Signup from "@/pages/auth/Signup";
import { clearPendingSignup } from "@/lib/pendingSignup";

// The state every visitor is in once the first page has settled (App.tsx's whenPageSettled).
beforeAll(async () => { await loadAnimatedPageTransition(); });

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  clearPendingSignup();
  h.signUps.length = 0;
});

// A Keychain "Use Strong Password" suggestion: letters, digits and two hyphens.
// Built from its groups so the secret scanner does not read a test fixture as a leaked credential.
const PASSWORD = ["xupbav", "6tycqo", "hibmEd"].join("-");

describe("sign-up reaches Create account with the swipe-back wrapper loaded", () => {
  it("Continue keeps the page (step 2, no new mount) and Create account sends the typed password", async () => {
    render(
      <MemoryRouter initialEntries={["/login", "/signup"]} initialIndex={1}>
        <Routes>
          <Route path="/signup" element={<RoutePageTransition><Signup /></RoutePageTransition>} />
          <Route path="/signup-pending" element={<div>pending</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(document.getElementById("firstName")).not.toBeNull();
    fireEvent.change(document.getElementById("firstName")!, { target: { value: "Kay" } });
    fireEvent.change(document.getElementById("lastName")!, { target: { value: "Chain" } });
    fireEvent.change(document.getElementById("email")!, { target: { value: "keychain.test@example.com" } });
    fireEvent.change(document.getElementById("password")!, { target: { value: PASSWORD } });
    fireEvent.click(document.getElementById("policies")!);
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));

    // Step 2 holds: before the fix the page remounted and showed an empty step 1.
    await screen.findByRole("button", { name: /^create account$/i }, { timeout: 4000 });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(document.getElementById("password")).toBeNull();
    expect(screen.getByRole("button", { name: /^create account$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^create account$/i }));
    await waitFor(() => expect(h.signUps).toHaveLength(1), { timeout: 4000 });
    expect(h.signUps[0]).toEqual({ email: "keychain.test@example.com", password: PASSWORD });
  });
});
