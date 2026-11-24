/**
 * Flow audit 11-23 (B3): Forgot password said "Check your inbox — we've sent a
 * reset link" when the request never left the phone. A transport failure
 * (offline / AuthRetryableFetchError) now shows an inline error and NOT the
 * sent screen; a server answer about the address (e.g. user not found) still
 * shows the neutral sent screen, so the screen stays enumeration-safe.
 *
 * @mutate src/pages/auth/ForgotPassword.tsx |       if (isTransportFailure(error)) { |       if (false) {
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

const submit = () => {
  render(<MemoryRouter><ForgotPassword /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: EMAIL } });
  fireEvent.submit(screen.getByLabelText(/email/i).closest("form") as HTMLFormElement);
};

describe("ForgotPassword: a send that never reached the server says so", () => {
  beforeEach(() => resetMock.mockReset());

  for (const [label, err] of [
    ["WebKit offline (AuthRetryableFetchError: Load failed)", Object.assign(new Error("Load failed"), { name: "AuthRetryableFetchError", status: 0 })],
    ["Chromium offline (Failed to fetch)", Object.assign(new Error("Failed to fetch"), { name: "AuthRetryableFetchError", status: 0 })],
    ["gateway 503", Object.assign(new Error("{}"), { name: "AuthRetryableFetchError", status: 503 })],
  ] as const) {
    it(`${label}: inline error, no "Check your inbox"`, async () => {
      resetMock.mockResolvedValue({ error: err });
      submit();
      expect(await screen.findByText(/couldn't send it\. check your connection and try again/i)).toBeInTheDocument();
      expect(screen.queryByText(/check your inbox/i)).toBeNull();
      // Typing again clears the error.
      fireEvent.change(screen.getByLabelText(/email/i), { target: { value: EMAIL + "x" } });
      expect(screen.queryByText(/couldn't send it/i)).toBeNull();
    });
  }

  it("a server answer about the address still looks like success (anti-enumeration)", async () => {
    resetMock.mockResolvedValue({ error: Object.assign(new Error("User not found"), { name: "AuthApiError", status: 400 }) });
    submit();
    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't send it/i)).toBeNull();
  });

  it("success shows the sent screen and no error", async () => {
    resetMock.mockResolvedValue({ error: null });
    submit();
    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't send it/i)).toBeNull();
  });
});
