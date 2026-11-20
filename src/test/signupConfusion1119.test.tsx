/**
 * Signup-confusion 11-19 (a real visitor, owner report): "tried creating an account on our website and it wouldn't let
 * him; it kept going back to the same page." Prod auth logs, 11-20 02:16-02:17 UTC, one phone: three POST /token
 * grant_type=password -> 400 "Invalid login credentials", then POST /recover, and NO /signup. He was on Log in
 * believing it was sign-up. After each miss Log in said "That email or password doesn't match. Give it another try."
 * and offered only a big "Forgot your password?" button, which is exactly where he went; the one way to sign-up was a
 * small line at the bottom, under the Apple and Google buttons.
 *
 * The class, held here:
 *  1. A failed sign-in (invalid_credentials, which GoTrue returns alike for an unknown email and a wrong password, so
 *     nothing reveals whether the address is registered) says "That email and password don't match an account." and
 *     puts a big Create an account button under it that carries the typed email to /signup.
 *  2. Both cards open with a Log in | Create account switch saying which form this is (AuthModeTabs).
 *  3. /signup fills the email the switch or the button carried.
 *  4. Password reset's neutral "sent" screen offers "No account yet? Create one."
 *  5. CLASS: no element in src/ labelled join / sign up / create account / get started routes to /login. Inventory:
 *     every Link, <a> and Button element in every tracked non-test .tsx file under src/ that targets /login.
 *
 * @mutate src/pages/auth/Login.tsx |         setCredMismatch(true); |         setCredMismatch(false);
 * @mutate src/pages/auth/Login.tsx |                     <Link to={signupHref} state={forgotState} data-login-no-match-signup=""> |                     <Link to="/forgot-password" state={forgotState} data-login-no-match-signup="">
 * @mutate src/pages/auth/Login.tsx | <div className="w-full mb-3"><AuthModeTabs active="login" signupHref={signupHref} email={email} /></div> | <div className="w-full mb-3" />
 * @mutate src/pages/auth/Signup.tsx |     if (typeof carriedEmail === "string" && carriedEmail.trim()) setEmail(carriedEmail.trim()); |     if (typeof carriedEmail === "number") setEmail("");
 * @mutate src/pages/auth/signup/SignupStep1.tsx | <div className="w-full mb-3"><AuthModeTabs active="signup" loginHref={loginHref} email={email} /></div> | <div className="w-full mb-3" />
 * @mutate src/pages/auth/Signup.tsx |   return safe ? `/login?redirect=${encodeURIComponent(safe)}` : "/login"; |   return "/login";
 * @mutate src/pages/auth/ForgotPassword.tsx |               <Link to="/signup" state={{ email: email.trim() }} | <Link to="/login" state={{ email: email.trim() }}
 * @mutate src/components/Navbar.tsx |                 to="/signup" |                 to="/login"
 * @mutate src/components/mobileNav/GateSheet.tsx |               navigate("/signup"); |               navigate("/login");
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/hooks/useCaptcha", () => ({
  useCaptcha: () => ({ ref: { current: null }, run: <T,>(fn: (token: string | undefined) => Promise<T>) => fn(undefined) }),
}));
vi.mock("@/components/auth/TurnstileField", () => ({ TurnstileField: () => null }));
vi.mock("@/lib/loginTransport", () => ({
  signInWithTimeout: async () => ({ data: { session: null }, error: Object.assign(new Error("Invalid login credentials"), { code: "invalid_credentials", status: 400 }) }),
  isTransportFailure: () => false,
}));
vi.mock("@/lib/haptics", () => ({ hapticMedium: () => {}, hapticSuccess: () => {}, hapticError: () => {}, hapticLight: () => {} }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => {} }));

import Login from "@/pages/auth/Login";
import Signup from "@/pages/auth/Signup";

function CarriedEmail() {
  const state = useLocation().state as { email?: string } | null;
  return <p data-testid="signup-probe">{state?.email ?? "(none)"}</p>;
}

const wrap = (ui: React.ReactNode, entry: string | { pathname: string; state?: unknown } = "/login") => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[entry]}>{ui}</MemoryRouter>
  </QueryClientProvider>
);

describe("signup-confusion 11-19: a new visitor on Log in is shown the way to Create account", () => {
  it("a failed sign-in says the pair matches no account and offers a big Create account that carries the email", async () => {
    localStorage.clear();
    const { container } = render(
      wrap(
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<CarriedEmail />} />
        </Routes>,
      ),
    );
    fireEvent.change(container.querySelector("#email")!, { target: { value: "charles@example.com" } });
    fireEvent.change(container.querySelector("#password")!, { target: { value: "a-new-password-1" } });
    fireEvent.submit(container.querySelector("form")!);
    const alert = await waitFor(() => {
      const el = container.querySelector("[data-login-cred-error]") as HTMLElement | null;
      expect(el).not.toBeNull();
      return el!;
    });
    expect(alert).toHaveTextContent("That email and password don't match an account.");
    expect(alert).toHaveTextContent("New to Louisiana Helpr?");
    // Never says which half was wrong, or that the address is (or isn't) registered.
    expect(alert.textContent ?? "").not.toMatch(/no account (with|for) th|isn't registered|not registered|wrong password|already/i);
    const create = alert.querySelector("[data-login-no-match-signup]") as HTMLAnchorElement | null;
    expect(create).not.toBeNull();
    expect(create!.textContent).toMatch(/^Create an account/);
    expect(create!.getAttribute("href")).toBe("/signup");
    // It is the big button (size lg, full width), not a small inline link.
    expect(create!.className).toMatch(/\bw-full\b/);
    expect(create!.className).toMatch(/h-\[60px\]|h-14|h-12/);
    // Forgot password stays, after it.
    expect(alert.querySelector('a[href="/forgot-password"]')).not.toBeNull();
    fireEvent.click(create!);
    expect(await screen.findByTestId("signup-probe")).toHaveTextContent("charles@example.com");
  });

  it("Log in opens with the Log in | Create account switch, Log in current", () => {
    localStorage.clear();
    const { container } = render(wrap(<Login />));
    const tabs = container.querySelector("[data-testid='auth-mode-tabs']")!;
    expect(tabs).not.toBeNull();
    const login = tabs.querySelector("[data-auth-tab='login']")!;
    const signup = tabs.querySelector("[data-auth-tab='signup']")!;
    expect(login.getAttribute("aria-current")).toBe("page");
    expect(signup.getAttribute("aria-current")).toBeNull();
    expect(signup.textContent).toBe("Create account");
    expect(signup.getAttribute("href")).toBe("/signup");
    // The switch comes before the heading and the form.
    const h1 = container.querySelector("h1")!;
    expect(tabs.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("/signup opens with the switch (Create account current) and fills the carried email", () => {
    sessionStorage.clear();
    const { container } = render(wrap(<Signup />, { pathname: "/signup", state: { email: "charles@example.com" } }));
    const tabs = container.querySelector("[data-testid='auth-mode-tabs']")!;
    expect(tabs).not.toBeNull();
    expect(tabs.querySelector("[data-auth-tab='signup']")!.getAttribute("aria-current")).toBe("page");
    expect(tabs.querySelector("[data-auth-tab='login']")!.getAttribute("href")).toBe("/login");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Create your account");
    expect((container.querySelector("#email") as HTMLInputElement).value).toBe("charles@example.com");
  });

  it("the switch keeps a pending same-site redirect in both directions", () => {
    sessionStorage.clear();
    const { container } = render(wrap(<Signup />, "/signup?redirect=%2Fjobs%2Fabc"));
    expect(container.querySelector("[data-auth-tab='login']")!.getAttribute("href")).toBe("/login?redirect=%2Fjobs%2Fabc");
  });

  it("password reset's neutral sent screen offers Create one, to /signup", () => {
    const src = blankComments(readFileSync("src/pages/auth/ForgotPassword.tsx", "utf8"));
    const sentAt = src.indexOf("{sent ? (");
    const formAt = src.indexOf("<form", sentAt);
    expect(sentAt).toBeGreaterThan(0);
    const sentBlock = src.slice(sentAt, formAt);
    expect(sentBlock).toContain('t("forgot.sentTail")');
    expect(sentBlock).toMatch(/<Link to="\/signup"[^>]*data-forgot-create-account/);
    const en = readFileSync("src/lib/i18n/enScreens.ts", "utf8");
    expect(en).toContain('"forgot.noAccount": "No account yet?"');
    expect(en).toContain('"forgot.createOne": "Create one"');
  });
});

describe("CLASS: a join / sign up / create account / get started control never routes to /login", () => {
  const JOINISH = /join|sign\s*-?\s*up|signup\.|create (an |your |a |free )?account|createAccount|get started|getStarted/i;
  const TO_LOGIN = /\b(?:to|href)=\{?["'`]\/login\b|navigate\(\s*["'`]\/login\b/;
  const ELEMENT = /<(Link|a|Button)\b([\s\S]*?)<\/\1>/g;
  const files = trackedFiles("src").filter((f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f) && !f.startsWith("src/test/"));
  const loginElements: { file: string; text: string }[] = [];
  for (const file of files) {
    const src = blankComments(readFileSync(file, "utf8"));
    for (const m of src.matchAll(ELEMENT)) {
      if (TO_LOGIN.test(m[0])) loginElements.push({ file, text: m[0] });
    }
  }

  it("the inventory is real", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(loginElements.length).toBeGreaterThan(15);
  });

  it("no /login element is labelled as joining", () => {
    // The label is the element's text after its opening tag (words, t()/w() keys and fallbacks).
    const offenders = loginElements.filter(({ text }) => JOINISH.test(text.slice(text.indexOf(">") + 1)));
    expect(offenders.map((o) => `${o.file}: ${o.text.slice(0, 160)}`)).toEqual([]);
  });

  it("the front door's Join free (marketing bar) and the guest gate's Create free account go to /signup", () => {
    const nav = blankComments(readFileSync("src/components/Navbar.tsx", "utf8"));
    const join = nav.indexOf('wordInLang("g.joinFree"');
    expect(join).toBeGreaterThan(0);
    const linkOpen = nav.lastIndexOf("<Link", join);
    expect(nav.slice(linkOpen, join)).toMatch(/to="\/signup"/);
    const gate = blankComments(readFileSync("src/components/mobileNav/GateSheet.tsx", "utf8"));
    const create = gate.indexOf("Create free account");
    expect(gate.slice(gate.lastIndexOf("<Button", create), create)).toMatch(/navigate\("\/signup"\)/);
  });
});
