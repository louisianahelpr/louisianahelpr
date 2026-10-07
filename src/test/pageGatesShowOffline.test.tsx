/**
 * Q571 (second half): a PAGE-LEVEL gate that waits on the signed-in user's
 * profile must say "offline", not hold its skeleton or spinner forever.
 *
 * Offline with nothing cached, useCurrentUser's query is PAUSED, and its
 * `isLoading` stays true for as long as the connection is down (the hook's
 * own test proves the premise). Measured on prod 2026-10-07 at 375, page code
 * loaded, every Supabase request held then the connection dropped, read at
 * +10 s: /profile and /profile?tab=pets stayed on their skeleton, /jobs/<id>
 * (signed in) on its job-card skeleton, /admin on the H spinner. The per-tab
 * offline cards Q571 built never mounted behind those gates.
 *
 * Inventory from source: every file outside src/test that reads `isLoading`
 * out of useCurrentUser() AND renders a skeleton or spinner from it as a
 * whole-page gate is listed here and must also read the profile query's phase
 * (useFeedPhase over `profileQuery`). Today: AdminRoute, JobDetail, Profile.
 *
 * @mutate src/components/AdminRoute.tsx | if (isLoading && phase === "offline-empty") { | if (false) {
 * @mutate src/pages/jobs/JobDetail.tsx | {(authLoading ? authPhase : phase) === "offline-empty" ? ( | {(authLoading ? "loading" : phase) === "offline-empty" ? (
 * @mutate src/components/profile/ProfileOfflineGate.tsx | if (phase !== "offline-empty") return <>{children}</>; | return <>{children}</>;
 * @mutate src/pages/profile/Profile.tsx |             <ProfileOfflineGate tab={tab} onBack={backFromTab}>\n | \n
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { blankComments } from "./helpers/blankNonCode";

const cu = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => cu.value }));

import AdminRoute from "@/components/AdminRoute";
import { ProfileOfflineGate } from "@/components/profile/ProfileOfflineGate";

const PAUSED = { status: "pending", fetchStatus: "paused" } as const;
const FETCHING = { status: "pending", fetchStatus: "fetching" } as const;

function loadingUser(profileQuery: { status: string; fetchStatus: string }) {
  cu.value = {
    user: { id: "u1" },
    profile: null,
    isAdmin: false,
    adminStatus: "unknown",
    isLoading: true,
    isError: false,
    refresh: vi.fn(async () => {}),
    profileQuery,
  };
}

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
);

describe("page gates that wait on the profile say offline (Q571)", () => {
  beforeEach(() => onlineManager.setOnline(false));
  afterEach(() => onlineManager.setOnline(true));

  it("AdminRoute: paused offline -> the offline card, never the children", () => {
    loadingUser(PAUSED);
    render(wrap(<AdminRoute><p>secret admin</p></AdminRoute>));
    expect(screen.getByText("You're offline.")).toBeTruthy();
    expect(screen.queryByText("secret admin")).toBeNull();
  });

  it("AdminRoute: online and still fetching -> the spinner, not the offline card (can fail)", () => {
    onlineManager.setOnline(true);
    loadingUser(FETCHING);
    render(wrap(<AdminRoute><p>secret admin</p></AdminRoute>));
    expect(screen.queryByText("You're offline.")).toBeNull();
    expect(screen.queryByText("secret admin")).toBeNull();
  });

  it("Profile's boot placeholder: paused offline -> the offline card under the tab's real header", () => {
    loadingUser(PAUSED);
    render(wrap(<ProfileOfflineGate tab="pets" onBack={() => {}}><p>skeleton</p></ProfileOfflineGate>));
    expect(screen.getByText("You're offline.")).toBeTruthy();
    expect(screen.queryByText("skeleton")).toBeNull();
    expect(screen.getByRole("heading", { name: "My Pets" })).toBeTruthy();
  });

  it("Profile's boot placeholder: online and fetching -> the skeleton (can fail)", () => {
    onlineManager.setOnline(true);
    loadingUser(FETCHING);
    render(wrap(<ProfileOfflineGate tab="landing" onBack={() => {}}><p>skeleton</p></ProfileOfflineGate>));
    expect(screen.getByText("skeleton")).toBeTruthy();
    expect(screen.queryByText("You're offline.")).toBeNull();
  });

  it("Profile wraps its whole boot placeholder in the gate", () => {
    const src = blankComments(readFileSync("src/pages/profile/Profile.tsx", "utf8"));
    const branch = src.slice(src.indexOf("if (loading) {"), src.indexOf("const displayName"));
    expect(branch.length).toBeGreaterThan(100);
    expect(branch).toMatch(/<ProfileOfflineGate tab=\{tab\} onBack=\{backFromTab\}>\s*\{tab === "landing"/);
  });

  it("every whole-page gate on useCurrentUser().isLoading also reads the profile query's phase", () => {
    const GATES = ["src/components/AdminRoute.tsx", "src/pages/jobs/JobDetail.tsx", "src/components/profile/ProfileOfflineGate.tsx"];
    expect(GATES.length).toBeGreaterThan(2);
    for (const f of GATES) {
      const src = blankComments(readFileSync(f, "utf8"));
      expect(src, `${f}: no longer gates on useCurrentUser — update this list`).toMatch(/useCurrentUser\(\)/);
      expect(src, `${f}: gates on the profile but never reads its offline phase`).toMatch(/useFeedPhase\(\s*profileQuery\b/);
      expect(src, `${f}: reads the phase but never renders the offline card`).toMatch(/<OfflineEmptyState\b/);
      // The phase must decide what renders, not merely be computed.
      const v = /const\s+(\w+)\s*=\s*useFeedPhase\(\s*profileQuery\b/.exec(src)?.[1];
      expect(v, `${f}: the profile phase is not held in a variable`).toBeTruthy();
      expect(src, `${f}: ${v} never chooses the offline branch`).toMatch(new RegExp(`\\b${v}\\b[^\\n]*[!=]==\\s*"offline-empty"`));
    }
  });
});
