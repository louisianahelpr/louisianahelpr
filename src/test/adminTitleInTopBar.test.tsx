/**
 * GUARD (owner, 2026-10-27, /admin?view=support at 1440): "support and any
 * other page title should be at the top, not pushed down like that". Every
 * admin view's back arrow and title sat in a row of its own inside the scroll
 * container, ~100px under the top bar (measured on prod: bar bottom y=56,
 * "Support" h1 top y=88 at 1440, with an empty band between).
 *
 * THE RULE: one header row. AdminFrame renders every view's header once
 * (AdminSectionHeader), and it lands IN the top bar's row:
 *   - desktop website: inside the global bar's title slot (PageTitleBar, the
 *     slot DesktopTopNav registers), left of the bell, as /jobs draws "Jobs";
 *   - phone: inside AdminTopBar's row, in place of the emblem, beside the bell.
 * Never in the scroll container. The Dashboard keeps the emblem and its own
 * greeting card. Measured with getBoundingClientRect on the real screen:
 * e2e/prod-audit/admin-chrome.spec.ts.
 *
 * @mutate src/pages/admin/AdminFrame.tsx |         {!isWebDesktop && <AdminTopBar titleRow={header} />} |         {!isWebDesktop && <AdminTopBar />}
 * @mutate src/pages/admin/AdminFrame.tsx |           {isWebDesktop && header} |           {header}
 * AUD31-48 (audit 10-31, 375): "License & insur…" and "Exception que…" were cut in the phone bar. Those views take
 * a short phone title (ADMIN_PHONE_TITLES); the desktop bar keeps the full name.
 * @mutate src/pages/admin/AdminFrame.tsx | phoneTitle={ADMIN_PHONE_TITLES[view]} | phoneTitle={undefined}
 * @mutate src/components/admin/AdminSectionHeader.tsx |             {phoneTitle ?? title} |             {title}
 * @mutate src/components/admin/AdminTopBar.tsx |         {titleRow ? <div className="min-w-0 flex-1">{titleRow}</div> : <HelprMark to="/home" size="sm" emblemOnly />} |         <HelprMark to="/home" size="sm" emblemOnly />
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AdminFrame } from "@/pages/admin/AdminFrame";
import { registerDesktopTitleSlot } from "@/components/header/PageTitleBar";

const desktop = vi.hoisted(() => ({ on: false }));

vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => desktop.on }));
vi.mock("@/components/NotificationPanel", () => ({
  default: () => <button type="button" data-testid="bell" aria-label="Notifications" />,
}));
// The title bars draw NotificationBell, which swaps the panel in: the same stand-in.
vi.mock("@/components/notificationPanel/NotificationBell", () => ({
  default: () => <button type="button" data-testid="bell" aria-label="Notifications" />,
}));
vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ toggleSidebar: () => {}, state: "collapsed" }),
}));
vi.mock("@/components/admin/AdminSidebar", () => ({ default: () => null }));
vi.mock("@/components/admin/AdminCommandPalette", () => ({ AdminCommandPalette: () => null }));
vi.mock("@/components/auth/SignOutConfirmDialog", () => ({ SignOutConfirmDialog: () => null }));

const VIEWS = ["support", "reports", "disputes", "stalled", "people", "settings"];
const LABELS: Record<string, string> = {
  home: "Dashboard", support: "Support", reports: "Reports", disputes: "Disputes",
  stalled: "Stuck Jobs", people: "Users", settings: "Settings",
  credentials: "License & insurance", exceptions: "Exception queue",
};

function renderFrame(view: string, isWebDesktop: boolean) {
  return render(
    <MemoryRouter>
      {/* The global desktop bar's title slot, as DesktopTopNav registers it. */}
      {isWebDesktop && (
        <header data-testid="desktop-bar">
          <div ref={registerDesktopTitleSlot} data-desktop-title-slot="" />
          <button type="button" data-testid="bell" aria-label="Notifications" />
        </header>
      )}
      <AdminFrame
        isWebDesktop={isWebDesktop}
        view={view}
        viewLabels={LABELS}
        handleViewChange={() => {}}
        navGroups={[]}
        getBadge={() => undefined}
        getBadgeColor={() => ""}
        showLogoutDialog={false}
        setShowLogoutDialog={() => {}}
        navigate={() => {}}
      >
        <p>view content</p>
      </AdminFrame>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  registerDesktopTitleSlot(null);
});

describe("every admin view's title sits in the top bar's row (owner 2026-10-27)", () => {
  it("covers several views (floor)", () => {
    expect(VIEWS.length).toBeGreaterThan(5);
  });

  for (const view of VIEWS) {
    it(`desktop: ${view}'s back arrow and h1 are in the global bar's title slot, not the scroll container`, () => {
      desktop.on = true;
      const { container } = renderFrame(view, true);
      const slot = container.querySelector("[data-desktop-title-slot]")!;
      const h1s = container.querySelectorAll("h1");
      expect(h1s.length).toBe(1);
      expect(slot.contains(h1s[0])).toBe(true);
      expect(h1s[0].textContent).toBe(LABELS[view]);
      expect(slot.querySelector("button")).not.toBeNull(); // the back arrow
      expect(container.querySelector("[data-admin-scroll] h1")).toBeNull();
    });

    it(`phone: ${view}'s back arrow and h1 are in the admin bar's row beside the bell`, () => {
      desktop.on = false;
      const { container, getByTestId } = renderFrame(view, false);
      const bar = container.querySelector("header")!;
      const h1s = container.querySelectorAll("h1");
      expect(h1s.length).toBe(1);
      expect(bar.contains(h1s[0])).toBe(true);
      expect(h1s[0].textContent).toBe(LABELS[view]);
      // Same row: the bar's one flex row holds the title and the bell.
      const row = bar.firstElementChild!;
      expect(row.contains(h1s[0])).toBe(true);
      expect(row.contains(getByTestId("bell"))).toBe(true);
      expect(container.querySelector("[data-admin-scroll] h1")).toBeNull();
    });
  }

  it("AUD31-48: the phone bar uses the short title where the full one was cut; the desktop bar keeps the full name", () => {
    for (const [view, short] of [["credentials", "Licenses"], ["exceptions", "Exceptions"]] as const) {
      desktop.on = false;
      const phone = renderFrame(view, false);
      expect(phone.container.querySelector("header h1")?.textContent).toBe(short);
      cleanup();
      desktop.on = true;
      const wide = renderFrame(view, true);
      expect(wide.container.querySelector("[data-desktop-title-slot] h1")?.textContent).toBe(LABELS[view]);
      cleanup();
      registerDesktopTitleSlot(null);
    }
  });

  it("the Dashboard draws no title row in either bar (its greeting card is the page's heading)", () => {
    desktop.on = false;
    const phone = renderFrame("home", false);
    expect(phone.container.querySelector("header h1")).toBeNull();
    cleanup();
    desktop.on = true;
    const wide = renderFrame("home", true);
    expect(wide.container.querySelector("[data-desktop-title-slot] h1")).toBeNull();
  });
});
