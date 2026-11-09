/**
 * F028 (owner UI audit 11-09): a wrong email or password said so only in a small toast in the bottom-right corner
 * that went away, while the email field still wore its green check. The words now sit above the Log in button (with
 * the Forgot password link) until either field changes, and the check is gone while they show.
 *
 * @mutate src/pages/auth/Login.tsx |         setCredError(friendlyAuthError(error.message)); |         toast.error(friendlyAuthError(error.message));
 * @mutate src/pages/auth/Login.tsx |               {emailValid && !credError && ( |               {emailValid && (
 * @mutate src/pages/auth/Login.tsx | onChange={(e) => { setPassword(e.target.value); setCredError(null); }} | onChange={(e) => setPassword(e.target.value)}
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
vi.mock("@/lib/loginTransport", () => ({
  signInWithTimeout: async () => ({ data: { session: null }, error: new Error("Invalid login credentials") }),
  isTransportFailure: () => false,
}));
vi.mock("@/lib/haptics", () => ({ hapticMedium: () => {}, hapticSuccess: () => {}, hapticError: () => {} }));
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => {} }));

import Login from "@/pages/auth/Login";

const WORDS = "That email or password doesn't match. Give it another try.";

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
    expect(alert.querySelector("a")?.getAttribute("href")).toBe("/forgot-password");
    expect(toastError).not.toHaveBeenCalledWith(WORDS);
    // It sits above the Log in button.
    const submit = screen.getByRole("button", { name: /^Log in$/ });
    expect(alert.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No green check over the email while the error shows.
    expect(container.querySelector("#email")!.parentElement!.querySelector("svg")).toBeNull();

    fireEvent.change(container.querySelector("#password")!, { target: { value: "another-try" } });
    expect(container.querySelector("[data-login-cred-error]")).toBeNull();
  });
});
