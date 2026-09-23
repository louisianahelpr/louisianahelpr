// The ORDER of ProtectedRoute's gates, pinned.
//
// `ProtectedRoute.test.ts` covers `isProfileGateAllowed` — a pure predicate.
// Nothing covered the sequence the gates run in: ban → email → completeness.
// (An approval-status gate once sat in this chain and trapped half-onboarded
// accounts on a review screen for a review that did not exist; the gate and
// both of its screens were deleted in Q193, and the cases below pin that a
// leftover `pending`/`denied` value routes nobody.)
//
// A reorder is exactly the kind of change that gets undone by the next person
// tidying the block, so each rung is asserted here rather than left to the
// comment above it.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const useCurrentUserMock = vi.fn();
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => useCurrentUserMock(),
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/analytics", () => ({
  track: vi.fn(),
  AhaEvent: { ForcedLogoutBounce: "forced_logout_bounce" },
}));

import ProtectedRoute from "./ProtectedRoute";

const CONFIRMED = "2026-08-01T00:00:00Z";

const completeProfile = {
  full_name: "Ada Boudreaux",
  avatar_url: "https://example.test/a.png",
  date_of_birth: "1990-01-01",
  phone: "(504) 555-0100",
  location: "New Orleans",
};
const emptyProfile = {
  full_name: null,
  avatar_url: null,
  date_of_birth: null,
  phone: null,
  location: null,
};

type Case = {
  emailConfirmedAt?: string | null;
  profile: Record<string, unknown>;
};

const renderAt = (
  path: string,
  { emailConfirmedAt = CONFIRMED, profile }: Case,
  props: { allowPending?: boolean; allowUnapproved?: boolean } = {},
) => {
  useCurrentUserMock.mockReturnValue({
    user: { id: "u1", email_confirmed_at: emailConfirmedAt },
    profile,
    isLoading: false,
    isError: false,
    refresh: vi.fn(),
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path={path.split("?")[0]}
          element={<ProtectedRoute {...props}><div>PROTECTED</div></ProtectedRoute>}
        />
        <Route path="/complete-profile" element={<div>COMPLETE_PROFILE</div>} />
        <Route path="/signup-pending" element={<div>VERIFY_EMAIL</div>} />
        <Route path="/account-banned" element={<div>ACCOUNT_BANNED</div>} />
        <Route path="/login" element={<div>LOGIN</div>} />
      </Routes>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  useCurrentUserMock.mockReset();
});

describe("ProtectedRoute gate order", () => {
  it("an incomplete profile goes to the form, whatever its approval_status says", () => {
    renderAt("/post-job", {
      profile: { ...emptyProfile, approval_status: "pending", is_legacy_user: false },
    });
    expect(screen.getByText("COMPLETE_PROFILE")).toBeTruthy();
  });

  // Q193 (owner 2026-09-23): no approval gate. A leftover `pending` or
  // `denied` value routes nobody anywhere — both screens were deleted.
  it.each(["pending", "denied"])(
    "a complete, confirmed %s account is let in (no approval gate, Q193)",
    (status) => {
      renderAt("/post-job", {
        profile: { ...completeProfile, approval_status: status, is_legacy_user: false },
      });
      expect(screen.getByText("PROTECTED")).toBeTruthy();
    },
  );

  it("a banned account is still bounced first, incomplete profile or not", () => {
    renderAt("/post-job", {
      profile: { ...emptyProfile, approval_status: "pending", ban_status: "banned" },
    });
    expect(screen.getByText("ACCOUNT_BANNED")).toBeTruthy();
  });

  it("an unconfirmed email still wins over the completeness gate", () => {
    // Nothing productive happens before the address is confirmed, and
    // /signup-pending (Check Your Email) is the screen holding Resend.
    renderAt("/post-job", {
      emailConfirmedAt: null,
      profile: { ...emptyProfile, approval_status: "pending", is_legacy_user: false },
    });
    expect(screen.getByText("VERIFY_EMAIL")).toBeTruthy();
  });

  it("allowPending does NOT exempt an incomplete profile from the form", () => {
    renderAt(
      "/dashboard",
      { profile: { ...emptyProfile, approval_status: "pending", is_legacy_user: false } },
      { allowPending: true },
    );
    expect(screen.getByText("COMPLETE_PROFILE")).toBeTruthy();
  });

  it("legacy users bypass the completeness gate entirely", () => {
    renderAt("/post-job", {
      profile: { ...emptyProfile, approval_status: "approved", is_legacy_user: true },
    });
    expect(screen.getByText("PROTECTED")).toBeTruthy();
  });

  it("an approved, complete profile is not redirected anywhere", () => {
    renderAt("/post-job", {
      profile: { ...completeProfile, approval_status: "approved", is_legacy_user: false },
    });
    expect(screen.getByText("PROTECTED")).toBeTruthy();
  });
});

describe("ProtectedRoute preserves the destination across the completeness gate", () => {
  it("carries path AND query into /complete-profile as ?next=", () => {
    // The redirect used to be a bare <Navigate to="/complete-profile">, which
    // dropped the destination entirely — a push deep link or a shared job URL
    // was lost the moment the gate fired, and the user finished the form on
    // /dashboard with nothing pointing back at what they had opened.
    let seen = "unset";
    useCurrentUserMock.mockReturnValue({
      user: { id: "u1", email_confirmed_at: CONFIRMED },
      profile: { ...emptyProfile, approval_status: "approved", is_legacy_user: false },
      isLoading: false,
      isError: false,
      refresh: vi.fn(),
    });
    render(
      <MemoryRouter initialEntries={["/jobs/abc?ref=notif"]}>
        <Routes>
          <Route path="/jobs/:id" element={<ProtectedRoute><div>PROTECTED</div></ProtectedRoute>} />
          <Route
            path="/complete-profile"
            element={<CaptureSearch onSearch={(s) => { seen = s; }}><div>COMPLETE_PROFILE</div></CaptureSearch>}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("COMPLETE_PROFILE")).toBeTruthy();
    expect(seen).toBe("?next=%2Fjobs%2Fabc%3Fref%3Dnotif");
  });

  it("does not append a ?next= for a root-level entry", () => {
    let seen = "unset";
    useCurrentUserMock.mockReturnValue({
      user: { id: "u1", email_confirmed_at: CONFIRMED },
      profile: { ...emptyProfile, approval_status: "approved", is_legacy_user: false },
      isLoading: false,
      isError: false,
      refresh: vi.fn(),
    });
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ProtectedRoute><div>PROTECTED</div></ProtectedRoute>} />
          <Route
            path="/complete-profile"
            element={<CaptureSearch onSearch={(s) => { seen = s; }}><div>COMPLETE_PROFILE</div></CaptureSearch>}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("COMPLETE_PROFILE")).toBeTruthy();
    expect(seen).toBe("");
  });
});

// MemoryRouter does not touch window.location, so the redirect target is read
// off the router instead.
function CaptureSearch({
  onSearch,
  children,
}: {
  onSearch: (search: string) => void;
  children: React.ReactNode;
}) {
  const search = useLocationSearch();
  onSearch(search);
  return <>{children}</>;
}

// Imported lazily at the bottom to keep the mock declarations at the top of the
// file, where vitest hoists them.
import { useLocation } from "react-router-dom";
function useLocationSearch() {
  return useLocation().search;
}

// PROVEN RED 2026-09-21: neutering the ban gate — so a banned or
// suspended account walks into every protected route instead of
// /account-banned — fails "a banned account is still bounced first,
// incomplete profile or not". That gate is first for a reason, and this file
// is what says so.
// SOURCE-TEXT PIN: jsdom renders the route tree with `useCurrentUser` mocked.
// It proves the CLIENT's gate order; it proves nothing about RLS, which is
// what actually stops a banned account reading rows if it reaches a screen
// anyway.
// @mutate src/components/ProtectedRoute.tsx | if (isLockedOut(profile.ban_status, profile.auto_suspended_until)) { | if (false) {
