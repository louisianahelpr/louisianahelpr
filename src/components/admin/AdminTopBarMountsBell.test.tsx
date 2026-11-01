/**
 * Mount wiring: the admin console's top bar draws the notification bell
 * (NotificationPanel) beside its menu toggle.
 *
 * NotificationPanel's own tests render it alone. Until 2026-10-17 the Admin
 * page mounted AdminTopBar directly, so a test that rendered Admin covered the
 * bar as the panel's grandparent. 752550a7a (Q806) moved the frame JSX into
 * AdminFrame, putting the bar one level deeper, and main's Vacuity (run
 * 39156137759, 2026-10-18) flagged NotificationPanel as tested only in
 * isolation. This renders the bar itself; the panel is stubbed (it has its
 * own tests), so the bar's wiring is what is checked.
 *
 * @mutate src/components/admin/AdminTopBar.tsx |           <NotificationPanel /> |           <></>
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminTopBar from "./AdminTopBar";

const toggleSidebar = vi.hoisted(() => vi.fn());

vi.mock("@/components/NotificationPanel", () => ({
  default: () => <button type="button" data-testid="notification-panel" aria-label="Notifications" />,
}));
// The title bars draw NotificationBell, which swaps the panel in: the same stand-in.
vi.mock("@/components/notificationPanel/NotificationBell", () => ({
  default: () => <button type="button" data-testid="notification-panel" aria-label="Notifications" />,
}));
vi.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ toggleSidebar, state: "collapsed" }),
}));

describe("AdminTopBar mounts the notification bell", () => {
  it("renders NotificationPanel next to the admin menu toggle", () => {
    render(
      <MemoryRouter>
        <AdminTopBar />
      </MemoryRouter>,
    );
    const bells = screen.getAllByTestId("notification-panel");
    expect(bells.length).toBe(1);
    const toggle = screen.getByRole("button", { name: "Open the admin menu" });
    // Same row: the bell and the toggle share the right-hand cluster.
    expect(toggle.parentElement).toBe(bells[0].parentElement);
    expect(toggle.parentElement?.children.length).toBeGreaterThan(1);
  });
});
