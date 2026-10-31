/**
 * Audit 2026-10-29 A3-C12: "Forgot password?" on /login dropped the address the member had
 * already typed. Login now hands it over in router state (never the URL), and the reset page
 * starts with it filled in; a direct visit still starts empty.
 *
 * @mutate src/pages/auth/ForgotPassword.tsx | useState(typeof carried === "string" ? carried : "") | useState("")
 * @mutate src/pages/auth/Login.tsx | state={{ email: email.trim() }} | state={{}}
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ForgotPassword from "./ForgotPassword";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: vi.fn(),
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());

const EMAIL = "jane.doe@example.com";

describe("Forgot password keeps the email typed on Log in (A3-C12)", () => {
  it("starts with the address handed over in router state", () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/forgot-password", state: { email: EMAIL } }]}>
        <ForgotPassword />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(/email/i)).toHaveValue(EMAIL);
  });

  it("a direct visit (no state) starts empty", () => {
    render(<MemoryRouter initialEntries={["/forgot-password"]}><ForgotPassword /></MemoryRouter>);
    expect(screen.getByLabelText(/email/i)).toHaveValue("");
  });

  it("Log in's link hands the typed email over in state, not in the URL", () => {
    const login = readFileSync(path.join(process.cwd(), "src/pages/auth/Login.tsx"), "utf8");
    expect(login).toMatch(/to="\/forgot-password"\s+state=\{\{ email: email\.trim\(\) \}\}/);
    expect(login).not.toMatch(/forgot-password\?[^"]*email/);
  });
});
