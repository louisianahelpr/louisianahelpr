/**
 * SETTINGS > INSTANT BOOK NEVER LANDS ON A BLANK SCREEN WHILE THE SWITCH IS OFF (Q2647).
 *
 * Account audit 1102d row 6 (~/.lh-shots/audit-1102d-findings.md, h-instant_book-375.png): with the
 * 'instant_book' switch off for everyone (owner 11-01) its tab drew nothing (ProfileTabPanels), yet
 * /profile?tab=instant_book still resolved, so an old link or notice opened an empty page with no title
 * and no Back. Profile.tsx now swaps that entry for Settings once the switch answers off (replace, so
 * Back never walks into it again), and leaves the tab alone while the switch is on or still loading.
 */
// @mutate src/pages/profile/Profile.tsx |     if (tab !== "instant_book" \|\| !instantBookOff) return; |     if (tab !== "instant_book" \|\| !instantBookOff \|\| tab) return;
// @mutate src/pages/profile/Profile.tsx | next.set("tab", "settings"); return next; }, { replace: true }); | next.set("tab", "settings"); return next; }, { replace: false });
// @mutate src/pages/profile/Profile.tsx |   const instantBookOff = instantBookSwitch.settled && !instantBookSwitch.on; |   const instantBookOff = !instantBookSwitch.on;
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLocation, useNavigate, type NavigateFunction } from "react-router-dom";

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

// The switch read is a promise the test settles. useFeature reads every switch
// in ONE batched call (feature_switches_for_me, nightly-red #2601), held under
// the key "(batch)" with the keys it asked for.
const switches = vi.hoisted(() => ({
  pending: new Map<string, { resolve: (v: unknown) => void; keys?: string[] }>(),
  mode: "hold" as "hold" | "error",
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: { p_key?: string; p_keys?: string[] }) => {
      if (fn !== "feature_enabled_for" && fn !== "feature_switches_for_me") return Promise.resolve({ data: null, error: null });
      if (switches.mode === "error") return Promise.resolve({ data: null, error: { message: "boom", code: "XX000" } });
      if (fn === "feature_switches_for_me") {
        return new Promise((ok) => switches.pending.set("(batch)", { resolve: ok, keys: args.p_keys ?? [] }));
      }
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

vi.mock("./ProfileTabPanels", () => ({ ProfileTabPanels: ({ tab }: { tab: string }) => <div data-testid="panel">{tab}</div> }));

import ProfilePage from "./Profile";

let loc = { pathname: "", search: "" };
let nav: NavigateFunction | null = null;
const LocationProbe = () => {
  const l = useLocation();
  loc = { pathname: l.pathname, search: l.search };
  nav = useNavigate();
  return null;
};

const renderAt = (entries: string[], index?: number) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={entries} initialIndex={index}>
        <ProfilePage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const answer = async (values: Record<string, boolean>) => {
  // The batched switch read starts a tick after the first render: wait for it, then settle it.
  await waitFor(() => expect(switches.pending.has("(batch)")).toBe(true));
  await act(async () => {
    switches.pending.get("(batch)")?.resolve({ data: values, error: null });
    await vi.advanceTimersByTimeAsync(50);
  });
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  switches.pending.clear();
  switches.mode = "hold";
  loc = { pathname: "", search: "" };
  nav = null;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("?tab=instant_book while the switch is off (Q2647)", () => {
  it("opens Settings once the switch answers off", async () => {
    renderAt(["/profile?tab=instant_book"]);
    await answer({ instant_book: false });
    await waitFor(() => expect(new URLSearchParams(loc.search).get("tab")).toBe("settings"));
    expect(screen.getByTestId("panel").textContent).toBe("settings");
  });

  it("replaces the entry, so one Back leaves Profile instead of reopening the blank tab", async () => {
    renderAt(["/home", "/profile?tab=instant_book"], 1);
    await answer({ instant_book: false });
    await waitFor(() => expect(new URLSearchParams(loc.search).get("tab")).toBe("settings"));
    await act(async () => { nav?.(-1); await vi.advanceTimersByTimeAsync(100); });
    expect(loc.pathname).toBe("/home");
  });

  it("leaves the tab alone while the switch has not answered", async () => {
    renderAt(["/profile?tab=instant_book"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(new URLSearchParams(loc.search).get("tab")).toBe("instant_book");
  });

  it("leaves the tab alone while the switch is on", async () => {
    renderAt(["/profile?tab=instant_book"]);
    await answer({ instant_book: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(new URLSearchParams(loc.search).get("tab")).toBe("instant_book");
  });

  it("never touches another tab when the switch is off", async () => {
    renderAt(["/profile?tab=security"]);
    await answer({ instant_book: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(new URLSearchParams(loc.search).get("tab")).toBe("security");
  });
});
