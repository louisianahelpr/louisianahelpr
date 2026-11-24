/**
 * F028 (owner UI audit 11-09): a wrong email or password said so only in a small toast in the bottom-right corner
 * that went away, while the email field still wore its green check. The words now sit above the Log in button (with
 * the Forgot password link) until either field changes, and the check is gone while they show.
 *
 * Signup-confusion 11-19: the invalid-credentials words are now "That email and password don't match an account." with a
 * Create account button and the Forgot password nudge under them (signupConfusion1119.test.tsx owns the button).
 * @mutate src/pages/auth/Login.tsx |         setCredError(t("login.noMatch")); |         toast.error(t("login.noMatch"));
 * @mutate src/pages/auth/Login.tsx |               {emailValid && !credError && ( |               {emailValid && (
 * @mutate src/pages/auth/Login.tsx | onChange={(e) => { setPassword(e.target.value); setCredError(null); setCredMismatch(false); }} | onChange={(e) => setPassword(e.target.value)}
 * @mutate src/pages/auth/Login.tsx |               ) : credError === EMAIL_NOT_CONFIRMED_MESSAGE \|\| credError === t("login.confirmEmailFirst") ? ( |               ) : credError === null ? (
 * @mutate src/pages/auth/Login.tsx |         setCredError(friendlyAuthError(error.message));\n        return; |         toast.error(friendlyAuthError(error.message));\n        return;
 * @mutate src/pages/auth/Login.tsx |       setCredError(t("login.tooManyAttempts", { minutes: minutesLeft })); // inline | toast.error(t("login.tooManyAttempts", { minutes: minutesLeft })); // inline
 *
 * Audit 11-23: a network failure and a lockout were still corner toasts gone in seconds; they use the same box now.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: toastError, success: vi.fn() }) }));
vi.mock("@/hooks/useCaptcha", () => ({
  useCaptcha: () => ({ ref: { current: null }, run: <T,>(fn: (token: string | undefined) => Promise<T>) => fn(undefined) }),
}));
vi.mock("@/components/auth/TurnstileField", () => ({ TurnstileField: () => null }));
const signInMessage = vi.hoisted(() => ({ value: "Invalid login credentials" }));
vi.mock("@/lib/loginTransport", () => ({
  signInWithTimeout: async () => ({ data: { session: null }, error: new Error(signInMessage.value) }),
  isTransportFailure: () => transport.down,
}));
const transport = vi.hoisted(() => ({ down: false }));
vi.mock("@/lib/haptics", () => ({ hapticMedium: () => {}, hapticSuccess: () => {}, hapticError: () => {} }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => {} }));

import Login from "@/pages/auth/Login";
import { writeAttemptState } from "@/pages/auth/loginAttempts";

const WORDS = "That email and password don't match an account."; // enScreens login.noMatch (signup-confusion 11-19)

describe("F028: a wrong email or password is said above Log in, not in a corner toast", () => {
  it("shows the words inline with the Forgot password link, drops the green check, and clears on typing", async () => {
    localStorage.clear();
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/login"]}>
          <Login />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.change(container.querySelector("#email")!, { target: { value: "dana@example.com" } });
    fireEvent.change(container.querySelector("#password")!, { target: { value: "not-the-password" } });
    // The green check shows on a valid email before the attempt.
    expect(container.querySelector("#email")!.parentElement!.querySelector("svg")).not.toBeNull();
    fireEvent.submit(container.querySelector("form")!);

    const alert = await waitFor(() => {
      const el = container.querySelector("[data-login-cred-error]") as HTMLElement | null;
      expect(el).not.toBeNull();
      return el!;
    });
    expect(alert).toHaveTextContent(WORDS);
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.querySelector('a[href="/forgot-password"]')).not.toBeNull();
    expect(toastError).not.toHaveBeenCalledWith(WORDS);
    // It sits above the Log in button.
    const submit = screen.getByRole("button", { name: /^Log in$/ });
    expect(alert.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No green check over the email while the error shows.
    expect(container.querySelector("#email")!.parentElement!.querySelector("svg")).toBeNull();

    fireEvent.change(container.querySelector("#password")!, { target: { value: "another-try" } });
    expect(container.querySelector("[data-login-cred-error]")).toBeNull();
  });

  // F259f (audit 11-10): an unverified account was told to check its inbox with no way to get the email again, beside
  // a second "Forgot password?". It now links to the check-email page (its Resend), with the typed address.
  it("F259f: an unverified account gets 'Send the email again', not a second Forgot password", async () => {
    localStorage.clear();
    signInMessage.value = "Email not confirmed";
    try {
      const { container } = render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter initialEntries={["/login"]}>
            <Login />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      fireEvent.change(container.querySelector("#email")!, { target: { value: "dana@example.com" } });
      fireEvent.change(container.querySelector("#password")!, { target: { value: "a-password-here" } });
      fireEvent.submit(container.querySelector("form")!);
      const alert = await waitFor(() => {
        const el = container.querySelector("[data-login-cred-error]") as HTMLElement | null;
        expect(el).not.toBeNull();
        return el!;
      });
      expect(alert).toHaveTextContent("Confirm your email first");
      const link = alert.querySelector("a")!;
      expect(link.textContent).toBe("Send the email again"); // enScreens "login.resendVerify"
      expect(link.getAttribute("href")).toBe("/signup-pending");
      expect(alert.querySelector('a[href="/forgot-password"]')).toBeNull();
    } finally {
      signInMessage.value = "Invalid login credentials";
    }
  });

  it("a network failure and a lockout are said in the same box above Log in, not in a corner toast", async () => {
    const renderLogin = () => render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/login"]}>
          <Login />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const attempt = async (container: HTMLElement) => {
      fireEvent.change(container.querySelector("#email")!, { target: { value: "dana@example.com" } });
      fireEvent.change(container.querySelector("#password")!, { target: { value: "a-password-here" } });
      fireEvent.submit(container.querySelector("form")!);
      return waitFor(() => {
        const el = container.querySelector("[data-login-cred-error]") as HTMLElement | null;
        expect(el).not.toBeNull();
        return el!;
      });
    };
    toastError.mockClear();
    localStorage.clear();
    transport.down = true;
    signInMessage.value = "Failed to fetch";
    try {
      const { container, unmount } = renderLogin();
      const alert = await attempt(container);
      expect(alert.getAttribute("role")).toBe("alert");
      expect(alert.textContent!.length).toBeGreaterThan(10);
      unmount();
    } finally {
      transport.down = false;
      signInMessage.value = "Invalid login credentials";
    }
    writeAttemptState({ attempts: [], lockedUntil: Date.now() + 4 * 60 * 1000 });
    const { container } = renderLogin();
    expect(await attempt(container)).toHaveTextContent(/Too many attempts/);
    expect(toastError).not.toHaveBeenCalled();
    localStorage.clear();
  });
});
