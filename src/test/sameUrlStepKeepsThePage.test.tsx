/**
 * Builder 3, whole-app audit 2026-11-10: a same-page history step must not remount the page.
 *
 * App.tsx wraps routes in RoutePageTransition, which keyed the page on location.key, and every push or replace makes
 * a new key. F260n made sign-up's Continue push a same-URL entry for step 2, so Continue remounted the page: it fell
 * back to step 1 with every field kept only in React state gone, the password above all (F259c's draft keeps names
 * and email, never the password), and Create account was never reached. A cold load's first entry has key "default",
 * which the step hook skipped, so Back from step 2 also left step 2 showing. F260u's guest /browse job sheet pushes a ?job= entry the same
 * way, so opening a job remounted the whole guest feed. A push whose state carries KEEP_PAGE now keeps the page's key;
 * any other navigation still remounts.
 *
 * Driven for real: the route wrapper App.tsx uses, the whole Signup page (step 1, Continue, step 2, Create account) and
 * the guest sheet hook. Only the network (supabase-js, HIBP) and toasts are stubbed.
 *
 * @mutate src/components/RoutePageTransition.tsx |   const pageKey = keepsPage ? prev.key : location.key; |   const pageKey = location.key;
 * @mutate src/components/RoutePageTransition.tsx | prev.pathname === location.pathname && keepsPageState(location.state) | keepsPageState(location.state)
 * @mutate src/pages/auth/signup/useSignupStepHistory.ts | step: 2, [KEEP_PAGE]: true } | step: 2 }
 * @mutate src/pages/auth/signup/useSignupStepHistory.ts |     if (navigationType === "POP") setStep( |     if (navigationType === "POP" && routerLocation.key !== "default") setStep(
 * @mutate src/pages/home/useGuestJobSheet.ts | [SHEET_ENTRY]: true, [KEEP_PAGE]: true } | [SHEET_ENTRY]: true }
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useEffect, type ReactNode } from "react";

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
        return { data: { user: { id: "10000000-0000-4000-8000-0000000000bb" }, session: null }, error: null };
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

import { RoutePageTransition } from "@/components/RoutePageTransition";
import { KEEP_PAGE } from "@/lib/keepPage";
import Signup from "@/pages/auth/Signup";
import { useGuestJobSheet } from "@/pages/home/useGuestJobSheet";
import type { EnrichedJob } from "@/components/dashboard/types";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  h.signUps.length = 0;
});

const PASSWORD = "Str0ng!Passw0rd#";

describe("sign-up's step 2 keeps step 1's fields inside the real route wrapper", () => {
  let nav: ReturnType<typeof useNavigate> = () => {};
  function Nav() {
    nav = useNavigate();
    return null;
  }
  function renderSignup() {
    render(
      <MemoryRouter initialEntries={["/signup"]}>
        <Nav />
        <Routes>
          <Route path="/signup" element={<RoutePageTransition><Signup /></RoutePageTransition>} />
          <Route path="/signup-pending" element={<div>pending</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }
  const passwordField = () => document.getElementById("password") as HTMLInputElement | null;
  async function fillStep1AndContinue() {
    fireEvent.change(document.getElementById("firstName")!, { target: { value: "Kay" } });
    fireEvent.change(document.getElementById("lastName")!, { target: { value: "Remount" } });
    fireEvent.change(document.getElementById("email")!, { target: { value: "remount.test@example.com" } });
    fireEvent.change(passwordField()!, { target: { value: PASSWORD } });
    fireEvent.click(document.getElementById("policies")!);
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    await screen.findByRole("button", { name: /^create account$/i });
  }

  it("Continue reaches step 2 with the page still mounted, and Create account sends the typed password", async () => {
    renderSignup();
    await fillStep1AndContinue();
    // Step 2 holds (it bounced straight back to an empty step 1 before the fix).
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(passwordField()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^create account$/i }));
    await waitFor(() => expect(h.signUps).toHaveLength(1), { timeout: 4000 });
    expect(h.signUps[0]).toEqual({ email: "remount.test@example.com", password: PASSWORD });
  });

  it("Back restores step 1 with the password, Forward restores step 2, and a real navigation still starts fresh", async () => {
    renderSignup();
    await fillStep1AndContinue();
    // The header's back pops the step-2 entry: step 1, every field kept.
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    await waitFor(() => expect(passwordField()?.value).toBe(PASSWORD));
    // Forward (a POP to the step-2 entry) shows step 2 again, still the same page.
    act(() => nav(1));
    await screen.findByRole("button", { name: /^create account$/i });
    act(() => nav(-1));
    await waitFor(() => expect(passwordField()?.value).toBe(PASSWORD));
    // A real navigation (a plain push, no KEEP_PAGE) remounts: the marker does not leak past its own step.
    act(() => nav("/signup"));
    await waitFor(() => expect(passwordField()?.value).toBe(""));
  });
});

describe("the route wrapper keeps a page only for a KEEP_PAGE step on the same path", () => {
  let mounts = 0;
  let go: ReturnType<typeof useNavigate> = () => {};
  let sheet: ReturnType<typeof useGuestJobSheet> | null = null;
  const JOB = { id: "20000000-0000-4000-8000-0000000000cc" } as unknown as EnrichedJob;
  function Page() {
    useEffect(() => { mounts += 1; }, []);
    go = useNavigate();
    sheet = useGuestJobSheet([JOB]);
    const loc = useLocation();
    return <p data-testid="where">{loc.pathname + loc.search}</p>;
  }
  function tree(children: ReactNode) {
    return (
      <MemoryRouter initialEntries={["/browse"]}>
        <Routes>
          <Route path="/browse" element={<RoutePageTransition>{children}</RoutePageTransition>} />
          <Route path="/other" element={<RoutePageTransition>{children}</RoutePageTransition>} />
        </Routes>
      </MemoryRouter>
    );
  }

  it("the guest job sheet's ?job= entry and its Back keep the feed mounted; other navigations remount", () => {
    mounts = 0;
    render(tree(<Page />));
    expect(mounts).toBe(1);
    act(() => sheet!.openDetailJob(JOB));
    expect(screen.getByTestId("where").textContent).toBe(`/browse?job=${JOB.id}`);
    expect(mounts).toBe(1);
    act(() => sheet!.closeDetailJob());
    expect(screen.getByTestId("where").textContent).toBe("/browse");
    expect(mounts).toBe(1);
    // A plain same-URL push (no KEEP_PAGE) still remounts, as before, and so does another page.
    act(() => go("/browse"));
    expect(mounts).toBe(2);
    act(() => go("/other"));
    expect(mounts).toBe(3);
    // KEEP_PAGE on a push to ANOTHER pathname is not a step within the page: it remounts.
    act(() => go("/browse", { state: { [KEEP_PAGE]: true } }));
    expect(mounts).toBe(4);
  });
});
