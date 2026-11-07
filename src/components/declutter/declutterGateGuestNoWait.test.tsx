/**
 * Q2705 (lead 11-07): a provable guest's /declutter does not wait for auth to settle. Live 2026-11-07 (cwv-lab, prod,
 * guest, Slow 4G + 4x): the guest gate's read began 2.3 s after the app drew, behind auth-ready and the lazy Supabase
 * import. A visitor with no stored session now gets the guest gate at once; a stored session (maybe a member) still
 * waits, so a member never sees the guest page flash.
 */
// @mutate src/components/declutter/declutterUi.tsx |   if (!isReady && !definitelyGuest()) return <>{skeleton}</>; |   if (!isReady) return <>{skeleton}</>;
// @mutate src/components/declutter/declutterUi.tsx |   if (!isReady && !definitelyGuest()) return <>{skeleton}</>; |
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false, useFeatureStatus: () => ({ on: false, settled: false }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: false }) }));
vi.mock("@/components/landing/useSectionsOpen", () => ({ useSectionsOpen: () => ({ open: new Set(["declutter"]), settled: true }) }));
vi.mock("./DeclutterGuest", () => ({
  DeclutterGuestGate: ({ children }: { children: ReactNode }) => <div data-testid="guest-gate">{children}</div>,
}));

import { DeclutterGate } from "./declutterUi";

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/declutter"]}>
        <DeclutterGate skeleton={<p>skeleton</p>}>
          <p>browse</p>
        </DeclutterGate>
      </MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(() => localStorage.clear());

describe("a provable guest's Declutter gate does not wait for auth (Q2705)", () => {
  it("no stored session: the guest gate at once, before auth settles", () => {
    show();
    expect(screen.getByTestId("guest-gate")).toBeTruthy();
    expect(screen.getByText("browse")).toBeTruthy();
    expect(screen.queryByText("skeleton")).toBeNull();
  });

  it("a stored session (maybe a member): the skeleton until auth settles, never the guest page", () => {
    localStorage.setItem("sb-x-auth-token", JSON.stringify({ access_token: "t", expires_at: 9999999999, user: { id: "me" } }));
    show();
    expect(screen.getByText("skeleton")).toBeTruthy();
    expect(screen.queryByTestId("guest-gate")).toBeNull();
  });
});
