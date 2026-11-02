/**
 * Q2250: Log in's two-step verification step had no h1. The only h1 lives in the card head, which is hidden while the
 * MFA challenge shows, and the challenge's title was an h2. Every Login state has exactly one h1: this renders the
 * password state, signs in with a verified TOTP factor (AAL1 -> AAL2 needed), and checks the MFA state's h1.
 *
 * @mutate src/pages/auth/Login.tsx |               <h1\n                className="font-display font-bold leading-tight"\n                style={{ fontSize: "clamp(1.2rem, 2vw + 0.4rem, 1.5rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}\n              >\n                {t("login.mfaTitle")}\n              </h1> |               <h2\n                className="font-display font-bold leading-tight"\n                style={{ fontSize: "clamp(1.2rem, 2vw + 0.4rem, 1.5rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}\n              >\n                {t("login.mfaTitle")}\n              </h2>
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null })),
        listFactors: vi.fn(async () => ({ data: { totp: [{ id: "f1", status: "verified" }] }, error: null })),
      },
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    },
  },
}));
vi.mock("@/lib/loginTransport", () => ({
  signInWithTimeout: vi.fn(async () => ({ data: { session: { user: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" } } }, error: null })),
  isTransportFailure: () => false,
}));
vi.mock("@/hooks/useCaptcha", () => ({
  useCaptcha: () => ({ run: (fn: (t: string) => unknown) => fn("tok"), enabled: false, ready: true, token: "tok", setToken: () => {}, reset: () => {} }),
}));
vi.mock("@/components/auth/TurnstileField", () => ({ TurnstileField: () => null }));
vi.mock("@/components/auth/SocialAuthButtons", () => ({ SocialAuthButtons: () => null }));
vi.mock("@/lib/haptics", () => ({ hapticMedium: () => {}, hapticSuccess: () => {}, hapticError: () => {} }));

import Login from "./Login";

const h1s = () => [...document.querySelectorAll("h1")].map((h) => (h.textContent ?? "").trim());

describe("Q2250: every Log in state has exactly one h1", () => {
  it("the password state and the two-step state each have one h1", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter initialEntries={["/login"]}><QueryClientProvider client={qc}><Login /></QueryClientProvider></MemoryRouter>);
    expect(h1s()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "dana@example.com" } });
    fireEvent.change(document.querySelector("input[type=password]") as HTMLInputElement, { target: { value: "secret-pass" } });
    fireEvent.submit((document.querySelector("input[type=password]") as HTMLInputElement).closest("form") as HTMLFormElement);
    await waitFor(() => expect(document.getElementById("mfa-login-code")).not.toBeNull());
    const heads = h1s();
    expect(heads).toHaveLength(1);
    expect(heads[0].length).toBeGreaterThan(3);
    expect(document.querySelector("h1")?.closest("form")).toBeNull();
  });
});
