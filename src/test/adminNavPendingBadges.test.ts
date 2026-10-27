/**
 * GUARD (owner, 2026-10-27): "there needs to be a better way to see these
 * tickets and open reports. I never noticed them. Maybe for the admin stuff
 * leave it open on the left panel". The Dashboard's Priority Alerts said 1 open
 * report and 6 support tickets, and nothing else on screen did.
 *
 * THE BUG, three layers:
 *  - the left nav's Admin group was collapsed by default and only auto-opened
 *    inside /admin;
 *  - its counts were published by Admin.tsx only while /admin was mounted, so
 *    from Home there were none;
 *  - Support / Reports / Disputes showed a "new since you looked" number that
 *    one visit cleared, while the waiting items stayed open.
 *
 * THE RULE, checked here:
 *  1. every queue row of adminNavGroups (Queues + Trust & Safety) is in
 *     ADMIN_QUEUE_IDS, exactly, and its badge is its OPEN count, which an
 *     unread number can never replace;
 *  2. the Admin row's number is the total of those counts;
 *  3. the desktop nav reads the counts itself (useAdminPendingCounts) on every
 *     page, keeps the group open unless this admin collapsed it on this device,
 *     and shows the total on the Admin row whether the group is open or not;
 *  4. Admin.tsx feeds the Priority Alerts from the SAME hook, and the hook reads
 *     Support and Reports from their screen's own Pending cache key and fetcher.
 * Measured live (rects, numbers equal on screen): e2e/prod-audit/admin-chrome.spec.ts.
 *
 * @mutate src/components/admin/adminRailBadges.ts |   if ((ADMIN_QUEUE_IDS as readonly string[]).includes(id)) return undefined;\n  const uc | \n  const uc
 * @mutate src/components/admin/adminRailBadges.ts |   return ADMIN_QUEUE_IDS.reduce((sum, id) => sum + (openQueues[id] ?? 0), 0); |   return 0;
 * @mutate src/components/DesktopSidebarNav.tsx | useState(() => safeStorage.getItem(ADMIN_NAV_OPEN_KEY) !== "0") | useState(() => safeStorage.getItem(ADMIN_NAV_OPEN_KEY) === "1")
 * @mutate src/components/DesktopSidebarNav.tsx |                 {adminTotal > 0 && ( |                 {!adminOpen && adminTotal > 0 && (
 * @mutate src/pages/admin/Admin.tsx |             supportTickets: openQueues.support ?? 0, |             supportTickets: 0,
 * @mutate src/components/admin/adminRailBadges.ts |     queryKey: supportQueueKey("pending"), |     queryKey: ["admin-support-count"],
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adminNavGroups } from "@/components/admin/adminNavGroups";
import { ADMIN_QUEUE_IDS, adminBadgeFor, adminPendingTotal } from "@/components/admin/adminRailBadges";
import { blankComments } from "./helpers/blankNonCode";

const read = (rel: string) => blankComments(readFileSync(join(process.cwd(), rel), "utf8"));
const nav = read("src/components/DesktopSidebarNav.tsx");
const admin = read("src/pages/admin/Admin.tsx");
const rail = read("src/components/admin/adminRailBadges.ts");

const queueRows = adminNavGroups
  .filter((g) => g.title === "Queues" || g.title === "Trust & Safety")
  .flatMap((g) => g.items.map((i) => i.id));

describe("admin queues are visible from the left nav on every page (owner 2026-10-27)", () => {
  it("reads the real nav groups and sources (floor)", () => {
    expect(queueRows.length).toBeGreaterThan(8);
    expect(nav.length).toBeGreaterThan(2000);
    expect(admin.length).toBeGreaterThan(2000);
  });

  it("ADMIN_QUEUE_IDS is exactly the queue rows of the nav (both ways)", () => {
    expect([...ADMIN_QUEUE_IDS].sort()).toEqual([...queueRows].sort());
  });

  it("a queue row shows its open count, never an unread number; other rows keep theirs", () => {
    const unread = Object.fromEntries([...queueRows, "jobs"].map((id) => [id, 7]));
    for (const id of queueRows) {
      expect(adminBadgeFor(id, unread, { [id]: 2 }), id).toBe(2);
      expect(adminBadgeFor(id, unread, {}), `${id} with no open count`).toBeUndefined();
    }
    expect(adminBadgeFor("jobs", unread, {})).toBe(7);
  });

  it("the Admin row's number is the total of every queue's open count", () => {
    const counts = Object.fromEntries(queueRows.map((id, i) => [id, i + 1]));
    expect(adminPendingTotal(counts)).toBe(queueRows.reduce((s, _, i) => s + i + 1, 0));
    expect(adminPendingTotal({})).toBe(0);
  });

  it("the desktop nav reads the counts on every page, stays open by default, and shows the total open or closed", () => {
    // Only an admin's nav mounts the reads (a member's page load makes none).
    expect(nav).toMatch(/\{isAdmin && <AdminNavGroup \/>\}/);
    expect(nav).toMatch(/const pending = useAdminPendingCounts\(true\);/);
    expect(nav).toMatch(/const adminTotal = adminPendingTotal\(pending\.data\);/);
    expect(nav).toMatch(/useState\(\(\) => safeStorage\.getItem\(ADMIN_NAV_OPEN_KEY\) !== "0"\)/);
    expect(nav).toMatch(/safeStorage\.setItem\(ADMIN_NAV_OPEN_KEY, next \? "1" : "0"\)/);
    // No auto-open effect overriding the admin's own choice.
    expect(nav).not.toMatch(/if \(adminActive\) setAdminOpen/);
    // The total is not gated on the group being closed.
    expect(nav).toMatch(/\{adminTotal > 0 && \(\s*<span\s+data-admin-total-badge=\{adminTotal\}/);
    expect(nav).toMatch(/const n = adminRowBadge\(id\);/);
  });

  it("the Priority Alerts and the nav read ONE hook, and Support/Reports read their screen's Pending list", () => {
    expect(admin).toMatch(/const openQueues = pendingCounts\.data;/);
    expect(admin).toMatch(/disputedJobs: openQueues\.disputes \?\? 0,/);
    expect(admin).toMatch(/openReports: openQueues\.reports \?\? 0,/);
    expect(admin).toMatch(/supportTickets: openQueues\.support \?\? 0,/);
    // The old separate counts (which counted test accounts' reports) are gone.
    expect(admin).not.toMatch(/from\("reports"\)\.select\("id", \{ count: "exact", head: true \}\)/);
    const hook = rail.slice(rail.indexOf("export function useAdminPendingCounts("));
    expect(hook).toMatch(/queryKey: supportQueueKey\("pending"\),\s*queryFn: async \(\) => \(await import\("@\/components\/admin\/AdminSupport"\)\)\.fetchSupportTickets\("pending"\)/);
    expect(hook).toMatch(/queryKey: reportsQueueKey\("pending"\),\s*queryFn: async \(\) => \(await import\("@\/components\/admin\/AdminReports"\)\)\.fetchReports\("pending"\)/);
    // The screens list under the same keys.
    expect(read("src/components/admin/AdminSupport.tsx")).toMatch(/const queryKey = supportQueueKey\(filter\);[\s\S]*?fetcher: \(\) => fetchSupportTickets\(filter\)/);
    expect(read("src/components/admin/AdminReports.tsx")).toMatch(/const queryKey = reportsQueueKey\(filter\);[\s\S]*?fetcher: \(\) => fetchReports\(filter\)/);
  });
});
