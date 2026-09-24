/**
 * AM-011: the admin queue badges rendered only in AdminSidebar, which mounts
 * only below the desktop breakpoint, so a desktop-web admin saw no queue counts
 * anywhere in the nav. Admin.tsx now publishes getBadge's numbers to
 * adminBadgeStore and DesktopSidebarNav renders them (screenshot 2026-09-24:
 * Jobs 4, Referrals 2 at 1440).
 *
 * @mutate src/pages/Admin.tsx | publishAdminBadges(next); | void next;
 * @mutate src/components/DesktopSidebarNav.tsx | {!!adminBadges[id] && ( | {false && (
 * @mutate src/components/admin/adminBadgeStore.ts | listeners.forEach((l) => l()); | void listeners;
 */
import { readFileSync } from "node:fs";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { publishAdminBadges, useAdminBadges } from "@/components/admin/adminBadgeStore";

describe("admin queue badges reach the desktop nav (AM-011)", () => {
  it("a published count reaches a subscriber", () => {
    const { result } = renderHook(() => useAdminBadges());
    act(() => publishAdminBadges({ disputes: 2 }));
    expect(result.current).toEqual({ disputes: 2 });
    act(() => publishAdminBadges({}));
    expect(result.current).toEqual({});
  });

  it("Admin publishes and the desktop nav renders every section's count", () => {
    expect(readFileSync("src/pages/Admin.tsx", "utf8")).toMatch(/publishAdminBadges\(next\);/);
    const nav = readFileSync("src/components/DesktopSidebarNav.tsx", "utf8");
    expect(nav).toMatch(/const adminBadges = useAdminBadges\(\);/);
    expect(nav).toMatch(/\{!!adminBadges\[id\] && \(/);
  });
});
