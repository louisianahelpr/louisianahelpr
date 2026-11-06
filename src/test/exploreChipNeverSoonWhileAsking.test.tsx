/**
 * The Explore chips never say "Soon" while the answer is still out (lead 11-05). useFeature reads false while
 * feature_switches_for_me is loading, so a member's Declutter chip read "Declutter / Soon" on every cold load,
 * although Declutter is open to everyone. While that read (or, for a guest, features_open_to_everyone) is pending,
 * a chip with a switch is NEUTRAL: its plain name drawn as a live chip draws it, accessible name without
 * "coming soon" (looked at 375: an empty caption slot left the names sitting high beside Jobs). Once the answer is in, a closed section says "Soon" as before and a live
 * one shows its plain name.
 *
 * @mutate src/components/sections/ExploreSwitcher.tsx |     const unknown = answerPending && s.feature !== null && !on; |     const unknown = false;
 * @mutate src/components/sections/ExploreSwitcher.tsx |   return qc.getQueryState(featureSwitchBatchKey(user?.id ?? null))?.status === "pending"; |   return false;
 * @mutate src/components/sections/ExploreSwitcher.tsx | <span data-soon-pending="" className="px-0.5">{name}</span> | <span data-soon-pending="" className="px-0.5">{name} Soon</span>
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/lib/sectionPrefsRow", () => ({
  fetchSectionPrefsRow: async () => ({ data: null, error: null }),
  saveSectionPrefsRow: async () => ({ error: null }),
}));
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const switches = vi.hoisted(() => ({ on: new Set<string>() }));
const auth = vi.hoisted(() => ({ user: { id: "u-1" } as { id: string } | null, isReady: true }));
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
vi.mock("@/hooks/useFeature", () => ({
  useFeature: (key: string) => switches.on.has(key),
  useFeatureStatus: (key: string) => ({ on: switches.on.has(key), settled: true, lastAnswer: switches.on.has(key) }),
}));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ ...auth, ready: auth.isReady }) }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: auth.user, profile: null, isLoading: false, isAdmin: false }),
}));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));

import { ExploreSwitcher } from "@/components/sections/ExploreSwitcher";
import { featureSwitchBatchKey } from "@/lib/featureSwitchQuery";
import { SECTIONS_OPEN_QUERY_KEY } from "@/components/landing/useSectionsOpen";

const mount = (qc: QueryClient) =>
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/jobs"]}>
        <ExploreSwitcher current="jobs" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
const chips = () => [...document.querySelectorAll('[data-testid="explore-switcher"] [role="radio"]')] as HTMLElement[];
const chip = (name: string) => chips().find((c) => (c.textContent ?? "").startsWith(name))!;
const visibleText = (el: HTMLElement) => {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll(".invisible").forEach((n) => n.remove());
  return (copy.textContent ?? "").trim();
};
/** A cache entry for `key` that is still pending, the way a mounted, unanswered query leaves it. */
const pendingClient = (key: readonly unknown[]) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.getQueryCache().build(qc, { queryKey: key as unknown[] });
  expect(qc.getQueryState(key as unknown[])?.status).toBe("pending");
  return qc;
};

describe("Explore chips stay neutral while the switch answer is out", () => {
  beforeEach(() => {
    cleanup();
    switches.on.clear();
    auth.user = { id: "u-1" };
    auth.isReady = true;
  });

  it("a member's chips say no 'Soon' while feature_switches_for_me is pending", () => {
    const qc = pendingClient(featureSwitchBatchKey("u-1"));
    mount(qc);
    expect(chips().length).toBeGreaterThan(1);
    const declutter = chip("Declutter");
    expect(visibleText(declutter)).toBe("Declutter");
    expect(declutter.getAttribute("aria-label")).toBe("Declutter");
    expect(declutter.querySelector("[data-soon-pending]")).toBeTruthy();
    for (const c of chips()) expect(visibleText(c)).not.toMatch(/Soon/);
  });

  it("once the answer is in: Declutter live shows its plain name, a closed section says Soon", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(featureSwitchBatchKey("u-1"), { declutter: true, shops: false, rentals: false });
    switches.on.add("declutter");
    mount(qc);
    expect(visibleText(chip("Declutter"))).toBe("Declutter");
    expect(chip("Declutter").querySelector("[data-soon-pending]")).toBeNull();
    const closed = chips().filter((c) => /Soon/.test(visibleText(c)));
    expect(closed.length).toBeGreaterThan(0);
    for (const c of closed) expect(c.getAttribute("aria-label")).toMatch(/coming soon/i);
  });

  it("a guest's chips stay neutral while features_open_to_everyone is pending", () => {
    auth.user = null;
    const qc = pendingClient(SECTIONS_OPEN_QUERY_KEY);
    mount(qc);
    expect(visibleText(chip("Declutter"))).toBe("Declutter");
    for (const c of chips()) expect(visibleText(c)).not.toMatch(/Soon/);
  });
});
