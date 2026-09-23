/**
 * DH-017 — a suspension that has already ended must not keep the app locked.
 *
 * `ProtectedRoute` gated on `ban_status` membership alone. The strike ladder
 * writes `temp_banned` + `auto_suspended_until = now() + 7 days`, and a
 * SCHEDULED server sweep flips the row back to `active` once that passes — so
 * for up to a full sweep interval after the penalty ended, the row still said
 * `temp_banned` and the user was still bounced to /account-banned, where the
 * banner showed them an expiry date in the past.
 *
 * This is the route-level repro: same three states, at the gate, rendering.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const currentUser: {
  user: { id: string; email_confirmed_at: string } | null;
  profile: Record<string, unknown> | null;
  isLoading: boolean;
  isError: boolean;
  refresh: () => Promise<void>;
} = {
  // Confirmed on the USER, where ProtectedRoute reads it. The copy on the
  // profile below never counted; this test passed only because the email gate
  // used to be skipped on this route (Q180 closed that).
  user: { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" },
  profile: null,
  isLoading: false,
  isError: false,
  refresh: async () => {},
};

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => currentUser }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), AhaEvent: { ForcedLogoutBounce: "x" } }));

import ProtectedRoute from "@/components/ProtectedRoute";

// A fully-complete, approved profile so the ONLY gate under test is the ban one.
const baseProfile = {
  is_legacy_user: true,
  full_name: "Test User",
  avatar_url: "https://example.com/a.png",
  date_of_birth: "1990-01-01",
  phone: "5550000000",
  location: "Baton Rouge",
  email_confirmed_at: "2026-01-01T00:00:00Z",
};

const renderGate = (profile: Record<string, unknown>) => {
  currentUser.profile = { ...baseProfile, ...profile };
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <div>DASHBOARD</div>
            </ProtectedRoute>
          }
        />
        <Route path="/account-banned" element={<div>BANNED SCREEN</div>} />
      </Routes>
    </MemoryRouter>,
  );
};

const hourAgo = () => new Date(Date.now() - 3600_000).toISOString();
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

beforeEach(() => {
  currentUser.user = { id: "u1", email_confirmed_at: "2026-01-01T00:00:00Z" };
  currentUser.isLoading = false;
  currentUser.isError = false;
});

describe("ProtectedRoute ban gate", () => {
  it("blocks an ACTIVE temp suspension", () => {
    renderGate({ ban_status: "temp_banned", auto_suspended_until: tomorrow() });
    expect(screen.getByText("BANNED SCREEN")).toBeTruthy();
  });

  it("lets a LAPSED temp suspension back into the app before the sweep runs", () => {
    renderGate({ ban_status: "temp_banned", auto_suspended_until: hourAgo() });
    expect(screen.getByText("DASHBOARD")).toBeTruthy();
  });

  it("still blocks a permanent ban whose timestamp is in the past", () => {
    renderGate({ ban_status: "permanently_banned", auto_suspended_until: hourAgo() });
    expect(screen.getByText("BANNED SCREEN")).toBeTruthy();
  });
});

// Put DH-017 back: `temp_banned` locks the account out regardless of when the
// suspension actually ended, so for up to a full sweep interval after their
// penalty expired the user is still bounced to /account-banned and shown an
// expiry date in the past. Behavioural — this is killed by the route rendering
// BANNED SCREEN where DASHBOARD belongs, not by any source text.
// @mutate supabase/functions/_shared/banStatus.ts | return until > now; | return true;
