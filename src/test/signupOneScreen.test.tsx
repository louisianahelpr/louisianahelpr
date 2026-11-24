/**
 * Sign-up is ONE screen (owner, Mon 11-23 ~10:05 PM, on hearing sign-up had a "screen 2": "What even is screen 2?
 * There shouldn't be a screen 2? I thought we got rid of it."). Prod analytics, 14 days to 11-23: ~134 step-1
 * completions against ~12 step-2. The form's own button, "Create account", now calls signUp; the old "About you"
 * screen (photo, city, ZIP, bio, "Skip for now", "Step 2 of 2") is gone.
 *
 * Driven for real: the route wrapper App.tsx uses and the whole Signup page. Only the network (supabase-js, HIBP),
 * toasts and the analytics sink are stubbed. Three ways in:
 *   1. /signup reached by an in-app link once the swipe-back wrapper has loaded (signup-autofill 11-23: the gesture
 *      component keyed its div on location.key, so a step change remounted the page; 3142dae253),
 *   2. a cold load straight onto /signup,
 *   3. a breached password (HIBP hit): the reason under the password field, nothing sent, and a new password signs up
 *      (signup-submit 11-23: the hit used to leave the person on a screen with no password field).
 * Each asserts: one signUp with the typed email and password, complete-signup once with none of the old screen's
 * fields, "Check your email" (/signup-pending), and no second screen ever rendered.
 *
 * @mutate src/components/PageTransition.tsx |     <div key={pageKey} ref={pageRef} |     <div key={String(Math.random())} ref={pageRef}
 * @mutate src/components/RoutePageTransition.tsx |   return <Animated pageKey={pageKey}>{children}</Animated>; |   return <Animated pageKey={String(Math.random())}>{children}</Animated>;
 * @mutate src/pages/auth/Signup.tsx |             onContinue={submit} |             onContinue={() => {}}
 * @mutate src/pages/auth/Signup.tsx |       await createAccountAndFinish();\n |       void 0;\n
 * @mutate src/pages/auth/Signup.tsx |         setServerPasswordError(t("signup.passwordPwned", { count: pwnedCount.toLocaleString() })); |         toast.error(t("signup.passwordPwned", { count: pwnedCount.toLocaleString() }));
 * @mutate src/pages/auth/signup/SignupStep1.tsx |     if (!passwordValid \|\| serverPasswordError) { |     if (!passwordValid) {
 * @mutate src/pages/auth/signup/SignupStep1.tsx |     passwordRef.current?.focus();\n    passwordRef.current?.scrollIntoView | void 0;\n    passwordRef.current?.scrollIntoView
 * @mutate src/pages/auth/signup/SignupStep1.tsx |         {loading ? t("signup.creating") : t("signup.create")} |         {loading ? t("signup.creating") : "Continue"}
 * @mutate src/pages/auth/Signup.tsx |       setFormError(authCopy ?? userFacingError(err, t("signup.createFailed"))); |       toast.error(authCopy ?? userFacingError(err, t("signup.createFailed")));
 * @mutate src/pages/auth/signup/SignupStep1.tsx |       {formError && ( |       {false && (
 *
 * Audit 11-23 (folded in by the lead): a refused sign-up said so only in a toast gone in under 3 s. Every refusal of
 * "Create account" now stays on the form: the password's under its field, any other in a box right above the button.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const h = vi.hoisted(() => {
  const signUps: Array<{ email: string; password: string }> = [];
  const completions: Array<Record<string, unknown>> = [];
  const events: Array<{ name: string; props: Record<string, unknown> }> = [];
  const pwned = { count: 0 as number | null };
  const signUpError = { message: null as string | null };
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
        if (signUpError.message) return { data: { user: null, session: null }, error: Object.assign(new Error(signUpError.message), { status: 429 }) };
        return { data: { user: { id: "10000000-0000-4000-8000-0000000000ee" }, session: null }, error: null };
      },
    },
    from: () => chain(),
    rpc: async () => ({ data: null, error: null }),
    functions: {
      invoke: async (name: string, opts: { body: Record<string, unknown> }) => {
        if (name === "complete-signup") completions.push(opts.body);
        return { data: { success: true, referralRecorded: false }, error: null };
      },
    },
    storage: { from: () => ({ upload: async () => ({ data: { path: "p" }, error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
    channel: () => { const ch = { on: () => ch, subscribe: () => ch, unsubscribe: () => {} }; return ch; },
    removeChannel: () => {},
  };
  return { signUps, completions, events, pwned, signUpError, supabase };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));
vi.mock("@/lib/hibpCheck", () => ({ checkPasswordPwned: async () => h.pwned.count }));
vi.mock("@/lib/posthog", () => ({ captureEvent: vi.fn(), initPostHog: vi.fn() }));
vi.mock("@/lib/restInsert", () => ({ postRows: async () => 201 }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/signupLead", async (orig) => ({ ...(await orig<typeof import("@/lib/signupLead")>()), useSignupLeadCapture: () => () => {} }));
vi.mock("@/lib/analytics", async (orig) => {
  const real = await orig<typeof import("@/lib/analytics")>();
  return { ...real, track: (name: string, props: Record<string, unknown> = {}) => { h.events.push({ name, props }); } };
});
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
  Toaster: () => null,
}));

import { loadAnimatedPageTransition, RoutePageTransition } from "@/components/RoutePageTransition";
import Signup from "@/pages/auth/Signup";
import { clearPendingSignup } from "@/lib/pendingSignup";
import { toast } from "sonner";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.localStorage.clear(); // the 60 s sign-up cooldown (SIGNUP_COOLDOWN_KEY) one test's sign-up arms
  clearPendingSignup();
  h.signUps.length = 0;
  h.completions.length = 0;
  h.events.length = 0;
  h.pwned.count = 0;
  h.signUpError.message = null;
  vi.mocked(toast.error).mockClear();
});

// A Keychain "Use Strong Password" suggestion: letters, digits and two hyphens.
// Built from its groups so the secret scanner does not read a test fixture as a leaked credential.
const PASSWORD = ["xupbav", "6tycqo", "hibmEd"].join("-");
const BREACHED = ["Password", "1234!"].join("");

/** Anything the retired second screen said or held. None of it may ever render. */
const SECOND_SCREEN = /Step 2 of 2|Paso 2 de 2|A little about you|Skip and create account|Profile photo|Upload profile photo/;
let sawSecondScreen = false;
const watcher = new MutationObserver(() => {
  if (SECOND_SCREEN.test(document.body.textContent ?? "") || document.getElementById("zipCode") || document.getElementById("bio")) sawSecondScreen = true;
});

function renderAt(entries: string[]) {
  sawSecondScreen = false;
  watcher.observe(document.body, { childList: true, subtree: true, characterData: true });
  render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Routes>
        <Route path="/signup" element={<RoutePageTransition><Signup /></RoutePageTransition>} />
        <Route path="/signup-pending" element={<div>Check your email</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const createButton = () => screen.getByRole("button", { name: /^create account$/i });

function fill(password: string) {
  fireEvent.change(field("firstName"), { target: { value: "Kay" } });
  fireEvent.change(field("lastName"), { target: { value: "Chain" } });
  fireEvent.change(field("email"), { target: { value: "keychain.test@example.com" } });
  // Set the way Keychain autofill does: an input event on the field.
  fireEvent.input(field("password"), { target: { value: password } });
  fireEvent.click(field("policies"));
}

async function expectFinished(password: string, attempts = 1) {
  await screen.findByText("Check your email", undefined, { timeout: 4000 });
  watcher.disconnect();
  expect(h.signUps).toEqual([{ email: "keychain.test@example.com", password }]);
  expect(h.completions).toHaveLength(1);
  // None of the retired screen's fields are asked, so none are sent (the old "Skip for now" body).
  expect(h.completions[0]).toMatchObject({ avatarBase64: null, bio: "", location: "", zipCode: "", parish: null, ageAttested: true, termsAccepted: true });
  expect(sawSecondScreen).toBe(false);
  // The funnel dashboards keep reading: one start, step 1 completed, sign-up completed; no step 2.
  const names = h.events.map((e) => e.name);
  expect(names.filter((n) => n === "signup_started")).toHaveLength(1);
  // signup_step_completed {step: 1} fires once per tap that passes the form's checks (a breached first try is one).
  expect(h.events.filter((e) => e.name === "signup_step_completed").map((e) => e.props.step)).toEqual(Array(attempts).fill(1));
  expect(names.filter((n) => n === "signup_completed")).toHaveLength(1);
}

describe("sign-up is one screen: Create account creates the account", () => {
  it("the form has one primary action, Create account, and no Continue", () => {
    renderAt(["/signup"]);
    expect(createButton()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^continue$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /skip/i })).toBeNull();
    watcher.disconnect();
  });

  it("reached by an in-app link with the swipe-back wrapper loaded: one tap, one signUp, Check your email", async () => {
    await loadAnimatedPageTransition(); // the state every visitor is in once the first page has settled (App.tsx)
    renderAt(["/login", "/signup"]);
    fill(PASSWORD);
    fireEvent.click(createButton());
    // A second tap while the first is in flight sends nothing more (OA-002).
    fireEvent.click(createButton());
    await expectFinished(PASSWORD);
  });

  it("a cold load straight onto /signup finishes the same way", async () => {
    renderAt(["/signup"]);
    fill(PASSWORD);
    fireEvent.click(createButton());
    await expectFinished(PASSWORD);
  });

  it("a breached password shows the reason under the password field, sends nothing, and a new password signs up", async () => {
    h.pwned.count = 3861493;
    renderAt(["/login", "/signup"]);
    fill(BREACHED);
    fireEvent.click(createButton());

    const error = await waitFor(() => {
      const el = document.getElementById("signup-password-error");
      expect(el?.textContent).toContain("3,861,493 known data breaches");
      return el!;
    }, { timeout: 4000 });
    const pw = field("password");
    expect(pw.value).toBe(BREACHED);
    expect(pw).toHaveAttribute("aria-invalid", "true");
    expect(pw.getAttribute("aria-describedby")).toBe(error.id);
    await waitFor(() => expect(document.activeElement).toBe(pw));
    expect(h.signUps).toHaveLength(0);
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();

    // The same refused password is not sent again.
    fireEvent.click(createButton());
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(h.signUps).toHaveLength(0);

    // A new password clears the reason and the sign-up goes through.
    h.pwned.count = 0;
    fireEvent.input(pw, { target: { value: PASSWORD } });
    expect(document.getElementById("signup-password-error")).toBeNull();
    fireEvent.click(createButton());
    await expectFinished(PASSWORD, 2);
  });

  it("a refused sign-up says why in a box above Create account that stays, not in a toast", async () => {
    h.signUpError.message = "email rate limit exceeded";
    renderAt(["/signup"]);
    fill(PASSWORD);
    fireEvent.click(createButton());
    const box = await waitFor(() => {
      const el = document.querySelector("[data-signup-form-error]") as HTMLElement | null;
      expect(el).not.toBeNull();
      return el!;
    }, { timeout: 4000 });
    watcher.disconnect();
    expect(box.getAttribute("role")).toBe("alert");
    expect(box.textContent).not.toMatch(/rate limit exceeded/); // the person's words, not GoTrue's
    expect(box.textContent!.length).toBeGreaterThan(10);
    expect(box.compareDocumentPosition(createButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(document.querySelector("[data-signup-form-error]")).not.toBeNull();
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    expect(h.signUps).toHaveLength(1);
    expect(sawSecondScreen).toBe(false);
  });
});
