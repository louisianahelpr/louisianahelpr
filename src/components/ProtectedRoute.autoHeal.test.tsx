// The recoverable profile-fetch error card AUTO-HEALS.
//
// ProtectedRoute shows "We couldn't load your account." only after the profile
// query has spent its whole budget (~12.5s). On a slow-but-working connection
// the read would have landed given more time, so leaving the user on a manual
// "Try again" tap is a dead end — and it is the biggest source of nightly
// false-reds whenever the CI runner's hop to prod is slower than that budget.
//
// So while the card is up, ProtectedRoute retries on a backoff (first at 4s)
// and the moment the profile arrives it renders the page. This pins BOTH: the
// timer fires refresh() unprompted (red before the auto-retry effect existed),
// and a profile landing after a retry clears the card for the real children.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
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

const renderRoute = () =>
  render(
    <MemoryRouter initialEntries={["/home"]}>
      <Routes>
        <Route
          path="/home"
          element={<ProtectedRoute><div>PROTECTED</div></ProtectedRoute>}
        />
        <Route path="/login" element={<div>LOGIN</div>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.useFakeTimers();
  useCurrentUserMock.mockReset();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("ProtectedRoute — recoverable profile error auto-heals", () => {
  it("fires refresh() unprompted while the error card is shown", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    useCurrentUserMock.mockReturnValue({
      user: { id: "u1", email_confirmed_at: "2026-08-01T00:00:00Z" },
      profile: null,
      isLoading: false,
      isError: true,
      refresh,
    });

    renderRoute();

    // The recoverable card is up, the user is kept signed in (not bounced).
    expect(screen.getByText(/We couldn't load your account/)).toBeTruthy();
    expect(screen.queryByText("LOGIN")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();

    // No tap. The first backoff step (4s) fires refresh on its own.
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(refresh).toHaveBeenCalledTimes(1);

    // It keeps trying on a widening backoff (next step 8s later).
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("stops retrying and shows the page once the profile lands", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    useCurrentUserMock.mockReturnValue({
      user: { id: "u1", email_confirmed_at: "2026-08-01T00:00:00Z" },
      profile: null,
      isLoading: false,
      isError: true,
      refresh,
    });

    const { rerender } = renderRoute();
    expect(screen.getByText(/We couldn't load your account/)).toBeTruthy();

    // The retry lands the profile: the hook now returns it, no error.
    useCurrentUserMock.mockReturnValue({
      user: { id: "u1", email_confirmed_at: "2026-08-01T00:00:00Z" },
      profile: { full_name: "Ada", is_legacy_user: true },
      isLoading: false,
      isError: false,
      refresh,
    });
    rerender(
      <MemoryRouter initialEntries={["/home"]}>
        <Routes>
          <Route
            path="/home"
            element={<ProtectedRoute><div>PROTECTED</div></ProtectedRoute>}
          />
          <Route path="/login" element={<div>LOGIN</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("PROTECTED")).toBeTruthy();
    expect(screen.queryByText(/We couldn't load your account/)).toBeNull();

    // The timer was cleaned up: no further refresh after the card is gone.
    const callsWhenHealed = refresh.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(refresh).toHaveBeenCalledTimes(callsWhenHealed);
  });
});

// Polarity, not deletion: the effect still exists, still schedules, still
// cleans up — it just arms on the wrong condition, so the error card never
// heals and the user is back on a manual "Try again" dead end.
// @mutate src/components/ProtectedRoute.tsx | if (!showingProfileError) return; | if (showingProfileError) return;
