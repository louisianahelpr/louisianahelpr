/**
 * THE DESKTOP RAIL SENDS NOTHING WHERE IT CANNOT SHOW (nightly-red #2375).
 *
 * DesktopSidebarNav is mounted on every page (App.tsx) and renders only on the
 * wide desktop website (>= 900px). Its hooks ran BEFORE that gate, so on every
 * phone page load the Declutter switch's `feature_enabled_for` RPC went out for
 * a rail that can never render: a11y-webkit-prod 38911703338 measured it x386
 * at 375 px (404 tests), which put the chromium leg's request budget at 22.5
 * per test against 22.2. The gate now sits in front of every hook the rail
 * calls; this renders the nav both ways and counts the rail's reads.
 *
 * @mutate src/components/DesktopSidebarNav.tsx | if (!isWebDesktop) return null; | if (isWebDesktop === null) return null;
 */
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ feature: [] as string[], desktop: false }));

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => calls.desktop }));
vi.mock("@/hooks/useFeature", () => ({
  useFeature: (key: string) => {
    calls.feature.push(key);
    return false;
  },
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, isAdmin: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, gate: (_k: string, fn: () => void) => fn, gatedProps: () => ({}) }) }));
vi.mock("@/hooks/useActivityBadgeCounts", () => ({ useActivityBadgeCounts: () => ({ postsCount: 0, jobsCount: 0 }) }));
vi.mock("@/components/mobileNav/useNavUnreadCount", () => ({ useNavUnreadCount: () => ({ unreadCount: 0 }) }));
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
  });

  it("at phone width (below 900px) it renders nothing and asks for no feature switch", () => {
    calls.desktop = false;
    const { container } = mount();
    expect(container.querySelector("nav")).toBeNull();
    expect(calls.feature, "a phone page load must not send the rail's feature_enabled_for").toEqual([]);
  });

  it("on the desktop website it renders and reads the Declutter switch (the check can see the call)", () => {
    calls.desktop = true;
    const { container } = mount();
    expect(container.querySelector('nav[aria-label="Primary"]')).not.toBeNull();
    expect(calls.feature).toContain("declutter");
  });
});
