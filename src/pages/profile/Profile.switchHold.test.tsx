/**
 * THE PROFILE LANDING PAINTS ONCE, WITH EVERY SWITCH-GATED ROW ALREADY IN
 * PLACE (Q1894).
 *
 * prod-audit run 39008504928, page-settle 375 /profile: cls 0.0599. The
 * Declutter row (hidden 'declutter' switch, on for testers) drew ~50 ms after
 * the rest of the landing and pushed the settings list 90px down (div
 * 325->415). Reproduced on a local build against prod data, poster-e2e, 375,
 * with the switch answer held 300 ms: shift 0.0594 in 3 of 3 runs before,
 * 0 of 3 after (~/.lh-shots/reds-1017/prof/{before-d300,after-d300}.log).
 *
 * Profile.tsx now keeps the landing's skeleton until every switch the landing
 * lays out around has answered (useFeatureStatus + the shared useArrivalGate,
 * capped at ARRIVAL_CAP_MS = 1.5 s after the profile is ready) so a hung read
 * never keeps Log out off screen.
 *
 * The CLASS: any useFeature("<key>") read in the landing's own files is a row
 * that can arrive late. The inventory below reads them from source, so a
 * switch added to the landing without being held here fails.
 */
// @mutate src/pages/profile/Profile.tsx | const showSkeleton = tab === "landing" ? !landingReady : loading; | const showSkeleton = loading;
// @mutate src/pages/profile/Profile.tsx | const landingReady = useArrivalGate(!loading, declutterSwitch.settled && membershipsSwitch.settled); | const landingReady = useArrivalGate(!loading, declutterSwitch.settled);
// @mutate src/pages/profile/Profile.tsx |   const membershipsSwitch = useFeatureStatus("memberships"); |   const membershipsSwitch = { on: false, settled: true };
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "@/test/helpers/blankNonCode";

const PROFILE = {
  id: "profile-1",
  user_id: "user-1",
  full_name: "Marie Boudreaux",
  phone: "3375550100",
  location: "Lafayette",
  zip_code: "70503",
  parish: "Lafayette",
  bio: "",
  skills: "",
  date_of_birth: "1980-01-01",
};

// Each switch read is a promise the test settles by key.
const switches = vi.hoisted(() => ({
  pending: new Map<string, { resolve: (v: unknown) => void }>(),
  mode: "hold" as "hold" | "error",
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: { p_key?: string }) => {
      if (fn !== "feature_enabled_for") return Promise.resolve({ data: null, error: null });
      if (switches.mode === "error") return Promise.resolve({ data: null, error: { message: "boom", code: "XX000" } });
      return new Promise((ok) => switches.pending.set(String(args.p_key), { resolve: ok }));
    },
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}));
vi.mock("@/hooks/useAuthReady", () => {
  const value = { user: { id: "user-1" }, isReady: true };
  return { useAuthReady: () => value };
});
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => {
    session.current ??= {
      user: { id: "user-1", email: "marie@example.com" },
      profile: PROFILE,
      isLoading: false,
      refresh: () => Promise.resolve(),
    };
    return session.current;
  },
}));
vi.mock("@/hooks/useProfileTabData", () => {
  const result = { data: undefined, isError: false, refetch: () => Promise.resolve() };
  const empty = () => result;
  return { useProfileStats: empty, useProfileReviews: empty, useProfileEarnings: empty, useProfileSchedule: empty, useProfileViolations: empty };
});
vi.mock("@/lib/parishLookup", () => ({ lookupParishByZip: () => Promise.resolve("Lafayette") }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/hooks/useDeleteAccount", () => {
  const value = { isOpen: false, requestDelete: () => {}, dialogProps: {} };
  return { useDeleteAccount: () => value };
});
vi.mock("@/components/profile/AvatarCropDialog", () => {
  const value = { requestCrop: () => Promise.resolve(null), dialog: null };
  return { useAvatarCrop: () => value };
});
vi.mock("@/components/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/profile/ProfileLanding", () => ({ ProfileLanding: () => <div data-testid="landing" /> }));
vi.mock("@/components/profile/ProfilePageSkeleton", () => ({ ProfilePageSkeleton: () => <div data-testid="skeleton" /> }));

import ProfilePage from "./Profile";

const renderLanding = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/profile"]}>
        <ProfilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const answer = async (key: string, on: boolean) => {
  await act(async () => {
    switches.pending.get(key)?.resolve({ data: on, error: null });
    // React Query publishes the result on a later tick: let it land, so a
    // "not yet" assertion right after this is about the page, not the queue.
    await vi.advanceTimersByTimeAsync(50);
  });
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  switches.pending.clear();
  switches.mode = "hold";
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the Profile landing waits for its switches (Q1894)", () => {
  it("keeps the skeleton until BOTH switches answer, then paints the landing", async () => {
    renderLanding();
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(screen.queryByTestId("skeleton")).toBeTruthy();
    expect(screen.queryByTestId("landing")).toBeNull();
    // Both reads start with the page, not with the landing.
    expect([...switches.pending.keys()].sort()).toEqual(["declutter", "memberships"]);
    await answer("declutter", true);
    expect(screen.queryByTestId("landing"), "painted before 'memberships' answered").toBeNull();
    await answer("memberships", false);
    expect(await screen.findByTestId("landing")).toBeTruthy();
    expect(screen.queryByTestId("skeleton")).toBeNull();
  });

  it("an error is an answer: the landing paints", async () => {
    switches.mode = "error";
    renderLanding();
    expect(await screen.findByTestId("landing")).toBeTruthy();
  });

  it("never waits more than 1.5 s for a read that hangs", async () => {
    renderLanding();
    await act(async () => { await vi.advanceTimersByTimeAsync(1400); });
    expect(screen.queryByTestId("landing")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.queryByTestId("landing")).toBeTruthy();
  });

  it("every switch the landing's own files read is one Profile.tsx holds (inventory from source)", () => {
    const root = resolve(__dirname, "../../components/profile");
    const files = [
      resolve(root, "ProfileLanding.tsx"),
      ...readdirSync(resolve(root, "profileLanding"))
        .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
        .map((f) => resolve(root, "profileLanding", f)),
    ];
    const read = new Set<string>();
    for (const f of files) {
      for (const m of blankComments(readFileSync(f, "utf8")).matchAll(/\buseFeature(?:Status)?\s*\(\s*"([a-z_]+)"\s*\)/g)) read.add(m[1]);
    }
    // FLOOR: the landing reads 'declutter' and 'memberships' today.
    expect(read.size, "found no useFeature reads in the landing: this guard has rotted").toBeGreaterThan(1);
    const profile = blankComments(readFileSync(resolve(__dirname, "Profile.tsx"), "utf8"));
    const held = new Set([...profile.matchAll(/\buseFeatureStatus\s*\(\s*"([a-z_]+)"\s*\)/g)].map((m) => m[1]));
    expect([...read].filter((k) => !held.has(k)), "a landing row gated on a switch Profile.tsx does not wait for").toEqual([]);
  });
});
