import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const navigateMock = vi.fn();
let currentUserState: { user: unknown; isAdmin: boolean; isLoading: boolean } = {
  user: null,
  isAdmin: false,
  isLoading: true,
};

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => currentUserState,
}));

import { useAdminAuth } from "./useAdminAuth";

describe("useAdminAuth", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    currentUserState = { user: null, isAdmin: false, isLoading: true };
  });

  it("does not navigate while currentUser is loading (avoids flash-redirect)", () => {
    currentUserState = { user: null, isAdmin: false, isLoading: true };
    renderHook(() => useAdminAuth());
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("redirects to /login when not authenticated", () => {
    currentUserState = { user: null, isAdmin: false, isLoading: false };
    renderHook(() => useAdminAuth());
    expect(navigateMock).toHaveBeenCalledWith("/login");
  });

  it("redirects to /dashboard when authenticated but not an admin", () => {
    currentUserState = { user: { id: "u1" }, isAdmin: false, isLoading: false };
    renderHook(() => useAdminAuth());
    expect(navigateMock).toHaveBeenCalledWith("/dashboard");
  });

  it("does not navigate when authenticated AND admin (allow access)", () => {
    currentUserState = { user: { id: "u1" }, isAdmin: true, isLoading: false };
    renderHook(() => useAdminAuth());
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("returns the current loading + admin + user state", () => {
    currentUserState = { user: { id: "u1" }, isAdmin: true, isLoading: false };
    const { result } = renderHook(() => useAdminAuth());
    expect(result.current.user).toEqual({ id: "u1" });
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it("re-checks when isLoading flips from true to false (auth resolved post-mount)", () => {
    currentUserState = { user: null, isAdmin: false, isLoading: true };
    const { rerender } = renderHook(() => useAdminAuth());
    expect(navigateMock).not.toHaveBeenCalled();

    currentUserState = { user: null, isAdmin: false, isLoading: false };
    rerender();
    expect(navigateMock).toHaveBeenCalledWith("/login");
  });
});
