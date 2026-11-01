/**
 * Mount wiring (vacuity scan, B45 10-31): ProtectedRoute's own tests render it alone, and nothing rendered the
 * Declutter route wrapper that mounts it (DeclutterGuestRoute.tsx, BUY-16). This renders the REAL wrapper: a
 * signed-in member (and a session still loading) goes through ProtectedRoute with the page inside it; a signed-out
 * guest gets the page directly. ProtectedRoute itself is a marker here (its gates have their own tests).
 *
 * @mutate src/components/declutter/DeclutterGuestRoute.tsx |   if (!isReady \|\| user) return <ProtectedRoute>{children}</ProtectedRoute>; |   if (!isReady) return <ProtectedRoute>{children}</ProtectedRoute>;
 * @mutate src/components/declutter/DeclutterGuestRoute.tsx |   if (!isReady \|\| user) return <ProtectedRoute>{children}</ProtectedRoute>; |   if (!isReady \|\| user) return <ProtectedRoute>{null}</ProtectedRoute>;
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import DeclutterGuestOrMember from "./DeclutterGuestRoute";

const auth = vi.hoisted(() => ({ value: { user: null as { id: string } | null, isReady: true } }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => auth.value }));
vi.mock("@/components/ProtectedRoute", () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="protected">{children}</div>,
}));

const show = () => render(<DeclutterGuestOrMember><p>Declutter page</p></DeclutterGuestOrMember>);

describe("the Declutter route wrapper mounts ProtectedRoute", () => {
  it("a signed-in member goes through ProtectedRoute, with the page inside it", () => {
    auth.value = { user: { id: "u1" }, isReady: true };
    show();
    expect(screen.getByTestId("protected").textContent).toBe("Declutter page");
  });
  it("while the session is still loading, ProtectedRoute decides", () => {
    auth.value = { user: null, isReady: false };
    show();
    expect(screen.getByTestId("protected").textContent).toBe("Declutter page");
  });
  it("a signed-out guest gets the page directly", () => {
    auth.value = { user: null, isReady: true };
    show();
    expect(screen.queryByTestId("protected")).toBeNull();
    expect(screen.getByText("Declutter page")).toBeTruthy();
  });
});
