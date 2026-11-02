/**
 * Q2251: a failed Apple/Google sign-in toast named the raw provider key
 * ("Couldn't sign in with google") beside a button that reads "Continue with
 * Google". The toast now uses the same display name as the button.
 *
 * Renders the real SocialAuthButtons with signInWithProvider answering
 * { kind: "error" } and reads the toast it raises.
 */
// @mutate src/components/auth/SocialAuthButtons.tsx | t("auth.socialFailed", { provider: providerName }) | t("auth.socialFailed", { provider })
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a) }) }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn() }));
vi.mock("@/lib/socialAuth", async (orig) => ({
  ...(await orig<typeof import("@/lib/socialAuth")>()),
  signInWithProvider: vi.fn(async () => ({ kind: "error", message: "" })),
}));

import { SocialAuthButtons } from "@/components/auth/SocialAuthButtons";

beforeEach(() => toastError.mockReset());

describe("a failed social sign-in names the provider as the button does", () => {
  for (const [name, button] of [["Google", /Continue with Google/i], ["Apple", /Continue with Apple/i]] as const) {
    it(`${name}: the toast says "${name}", never the raw key`, async () => {
      render(<MemoryRouter><SocialAuthButtons /></MemoryRouter>);
      const buttons = screen.getAllByRole("button", { name: button });
      expect(buttons.length).toBeGreaterThan(0);
      fireEvent.click(buttons[0]);
      await waitFor(() => expect(toastError).toHaveBeenCalled());
      const text = String(toastError.mock.calls[0][0]);
      expect(text).toContain(name);
      expect(text).not.toContain(name.toLowerCase());
    });
  }
});
