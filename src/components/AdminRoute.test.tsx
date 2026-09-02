import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AdminRoute from "./AdminRoute";
import type { AdminStatus } from "@/hooks/useCurrentUser";

/**
 * The regression this file exists for.
 *
 * AdminRoute used to read only `isAdmin`, and `isAdmin === false` meant BOTH
 * "we asked and you are not an admin" AND "we could not ask". A real admin on
 * a connection slow enough to cross useCurrentUser's 10s role-query timeout was
 * therefore redirected to /dashboard with nothing on screen explaining it — a
 * silent lockout that cost two lanes their admin surfaces before it was found,
 * and that a code read cannot see, because the class of the bug is two states
 * sharing one boolean.
 *
 * `useCurrentUser` now answers with a tri-state `adminStatus`; these tests pin
 * that AdminRoute renders a DIFFERENT thing for each of the three, and — the
 * half that actually matters for security — that `unknown` still grants
 * nothing. The hook's own behaviour (why a failed lookup is `unknown` rather
 * than `not_admin`) is covered in useCurrentUser.test.tsx.
 *
 * The hook is mocked rather than its Supabase calls: AdminRoute's whole
 * contract is "given this status, render that", and driving it through a fake
 * PostgREST layer would test the hook a second time instead of this component.
 */

const hookState: {
  adminStatus: AdminStatus;
  isLoading: boolean;
  refresh: ReturnType<typeof vi.fn>;
} = {
  adminStatus: "unknown",
  isLoading: false,
  refresh: vi.fn(),
};

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({
    user: { id: "u1" },
    profile: null,
    isAdmin: hookState.adminStatus === "admin",
    adminStatus: hookState.adminStatus,
    isLoading: hookState.isLoading,
    isError: false,
    refresh: hookState.refresh,
  }),
}));

// errorLogger posts to Supabase; the route-level report is a side effect, not
// the contract under test.
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

const renderAt = () =>
  render(
    <MemoryRouter initialEntries={["/admin"]}>
      <Routes>
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <div>ADMIN CONSOLE</div>
            </AdminRoute>
          }
        />
        <Route path="/dashboard" element={<div>DASHBOARD</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe("AdminRoute", () => {
  beforeEach(() => {
    hookState.refresh = vi.fn().mockResolvedValue(undefined);
    hookState.isLoading = false;
  });

  it("renders the console for a CONFIRMED admin", () => {
    hookState.adminStatus = "admin";
    renderAt();
    expect(screen.getByText("ADMIN CONSOLE")).toBeInTheDocument();
  });

  it("still redirects a CONFIRMED non-admin — the redirect is correct for them", () => {
    hookState.adminStatus = "not_admin";
    renderAt();
    expect(screen.getByText("DASHBOARD")).toBeInTheDocument();
    expect(screen.queryByText("ADMIN CONSOLE")).not.toBeInTheDocument();
  });

  it("shows a retry card — NOT a redirect — when the role could not be determined", () => {
    hookState.adminStatus = "unknown";
    renderAt();
    expect(screen.getByText(/couldn't verify your access/i)).toBeInTheDocument();
    // The whole point: the admin stays on /admin instead of being bounced.
    expect(screen.queryByText("DASHBOARD")).not.toBeInTheDocument();
  });

  it("GRANTS NOTHING on `unknown` — the privilege check still fails closed", () => {
    hookState.adminStatus = "unknown";
    renderAt();
    expect(screen.queryByText("ADMIN CONSOLE")).not.toBeInTheDocument();
  });

  it("recovers: retry re-fetches, and a now-confirmed admin gets the console", async () => {
    hookState.adminStatus = "unknown";
    const { rerender } = renderAt();

    const retry = screen.getByRole("button", { name: /try again/i });
    fireEvent.click(retry);
    expect(hookState.refresh).toHaveBeenCalledTimes(1);

    // The refetch lands and the role resolves.
    hookState.adminStatus = "admin";
    rerender(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <div>ADMIN CONSOLE</div>
              </AdminRoute>
            }
          />
          <Route path="/dashboard" element={<div>DASHBOARD</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("ADMIN CONSOLE")).toBeInTheDocument());
  });

  it("shows the spinner while the lookup is still in flight (no premature redirect)", () => {
    hookState.adminStatus = "unknown";
    hookState.isLoading = true;
    renderAt();
    expect(screen.queryByText("DASHBOARD")).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn't verify your access/i)).not.toBeInTheDocument();
    expect(screen.queryByText("ADMIN CONSOLE")).not.toBeInTheDocument();
  });
});
