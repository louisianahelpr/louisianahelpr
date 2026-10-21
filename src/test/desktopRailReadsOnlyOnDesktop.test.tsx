/**
 * THE DESKTOP RAIL SENDS NOTHING WHERE IT CANNOT SHOW (nightly-red #2375).
 *
 * DesktopSidebarNav is mounted on every page (App.tsx) and renders only on the
 * wide desktop website (>= 900px). Its hooks ran BEFORE that gate, so on every
 * phone page load the hidden-switch destinations' `feature_enabled_for` RPCs
 * went out for a rail that can never render: a11y-webkit-prod 38911703338
 * (2026-10-16) measured it x386 at 375 px (404 tests) with one switch, which put the
 * chromium leg's request budget at 22.5 per test against 22.2; with three
 * switches 39167774119 (2026-10-18) read feature_enabled_for x1503 over 448 tests (25 per
 * test). The gate now sits in front of every hook the rail calls; this renders
 * the nav both ways and counts the rail's reads.
 *
 * @mutate src/components/DesktopSidebarNav.tsx | if (!isWebDesktop) return null; | if (isWebDesktop === null) return null;
 */
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ feature: [] as string[], badges: 0, unread: 0, previews: 0, desktop: false }));

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => calls.desktop }));
vi.mock("@/hooks/useFeature", () => ({
  useFeature: (key: string) => {
    calls.feature.push(key);
    return false;
  },
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, isAdmin: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, gate: (_k: string, fn: () => void) => fn, gatedProps: () => ({}) }) }));
vi.mock("@/lib/needsYouStore", () => ({
  useNeedsYouCounts: () => {
    calls.badges++;
    return { total: 0, jobs: 0, shops: 0 };
  },
}));
vi.mock("@/components/mobileNav/useNavUnreadCount", () => ({
  useNavUnreadCount: () => {
    calls.unread++;
    return { unreadCount: 0 };
  },
}));
// The "Preview" mark's read (features_open_to_everyone, via useSectionTabs) is one of the rail's reads too.
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({
  ...(await orig<object>()),
  useOpenToEveryoneAnswer: () => {
    calls.previews++;
    return null;
  },
}));
vi.mock("@/components/admin/adminBadgeStore", () => ({ useAdminBadges: () => ({}) }));
vi.mock("@/components/sidePanelOpen", () => ({ useSidePanel: () => ({ open: true }) }));

import DesktopSidebarNav from "@/components/DesktopSidebarNav";

const mount = () =>
  render(
    <MemoryRouter initialEntries={["/home"]}>
      <DesktopSidebarNav />
    </MemoryRouter>,
  );

describe("the desktop rail reads only where it renders", () => {
  beforeEach(() => {
    calls.feature.length = 0;
    calls.badges = 0;
    calls.unread = 0;
    calls.previews = 0;
  });

  it("at phone width (below 900px) it renders nothing and asks for no feature switch or badge count", () => {
    calls.desktop = false;
    const { container } = mount();
    expect(container.querySelector("nav")).toBeNull();
    expect(calls.feature, "a phone page load must not send the rail's feature_enabled_for").toEqual([]);
    expect(calls.badges + calls.unread, "nor read its badge counts").toBe(0);
    expect(calls.previews, "nor ask which sections are open to everyone").toBe(0);
  });

  it("on the desktop website it renders and reads every hidden-switch destination (the check can see the calls)", () => {
    calls.desktop = true;
    const { container } = mount();
    expect(container.querySelector('nav[aria-label="Primary"]')).not.toBeNull();
    // Floor: Declutter and Shops (Quotes left the rail with the /quotes hub, owner 2026-10-19).
    expect(calls.feature.length).toBeGreaterThan(1);
    expect(calls.feature).toEqual(expect.arrayContaining(["declutter", "shops"]));
    expect(calls.badges).toBeGreaterThan(0);
    expect(calls.previews).toBeGreaterThan(0);
  });
});
