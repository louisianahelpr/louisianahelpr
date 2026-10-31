/**
 * Forgot password: a send that succeeds shows its result ("Check your inbox",
 * naming the address, enumeration-safe "If … is registered"), never only a
 * button label. One row of authEmailSendsShowAResult's inventory.
 *
 * @mutate src/pages/auth/ForgotPassword.tsx |       setSent(true); |       ;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ForgotPassword from "./ForgotPassword";

const resetMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: (...args: unknown[]) => resetMock(...args),
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());

const EMAIL = "jane.doe@example.com";

describe("ForgotPassword shows the result of a send", () => {
  beforeEach(() => {
    resetMock.mockReset().mockResolvedValue({ error: null });
  });

  it("a successful send shows Check your inbox with the address, enumeration-safe", async () => {
    render(<MemoryRouter><ForgotPassword /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: EMAIL } });
    fireEvent.submit(screen.getByLabelText(/email/i).closest("form") as HTMLFormElement);

    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    expect(screen.getByText(/is registered, we've sent a reset link/i)).toBeInTheDocument();
  });
});
