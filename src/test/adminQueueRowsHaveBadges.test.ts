/**
 * GUARD (Q1071): every admin rail row that is a queue of people or money
 * waiting on a human decision shows a live count.
 *
 * THE BUG: Stuck Jobs (escalated stalled jobs holding escrow) had no rail
 * badge, so a held payment waited unseen unless an admin opened the screen.
 * Fixed: Admin.tsx reads admin_stalled_job_queue's open rows and adminBadgeFor
 * returns them for "stalled".
 *
 * THE CLASS, from adminNavGroups: every row under "Queues" and "Trust &
 * Safety" has a badge source (an `id === "<row>"` branch in adminBadgeFor,
 * src/components/admin/adminRailBadges.ts, or a `key: "<row>"` loadUnreadCounts section), except the
 * EXACT list below, which is open work (Q1653). The list is two-way: a row
 * that gains a badge must leave it.
 *
 * @mutate src/components/admin/adminRailBadges.ts | if (id === "stalled" && (openQueues.stalled ?? 0) > 0) return openQueues.stalled; | void openQueues;
 * @mutate src/components/admin/adminRailBadges.ts | const seed = await fetchSeedUserIds(rows.flatMap((r) => [r.customer_id, r.helper_id])); | const seed = new Set<string>();
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adminNavGroups } from "@/components/admin/adminNavGroups";
import { blankComments } from "./helpers/blankNonCode";

// Q1653: queues still without a rail count (2026-10-12).
// @two-way src/test/adminQueueRowsHaveBadges.test.ts:stale baseline entry ${id} — remove it (lower the baseline)
const KNOWN_NO_BADGE = ["banreview", "credentials", "exceptions", "fraud", "idvreview"];

const admin = blankComments(readFileSync(join(process.cwd(), "src/pages/admin/Admin.tsx"), "utf8"));
const rail = blankComments(readFileSync(join(process.cwd(), "src/components/admin/adminRailBadges.ts"), "utf8"));
const badgeFor = rail.slice(rail.indexOf("function adminBadgeFor("), rail.indexOf("export function useStalledQueueCount("));
const hasBadge = (id: string) =>
  new RegExp(`id === "${id}"`).test(badgeFor) || new RegExp(`key: "${id}"`).test(admin);

const queueRows = adminNavGroups
  .filter((g) => g.title === "Queues" || g.title === "Trust & Safety")
  .flatMap((g) => g.items.map((i) => i.id));

describe("admin queue rows show a live count (Q1071)", () => {
  it("reads the rail and the badge function (floor)", () => {
    expect(queueRows.length).toBeGreaterThan(8);
    expect(badgeFor.length).toBeGreaterThan(200);
  });

  it("Stuck Jobs has a badge source that reads the open stalled queue", () => {
    expect(hasBadge("stalled")).toBe(true);
    // Admin.tsx mounts the count and feeds it to the rail.
    expect(admin).toMatch(/const stalledCount = useStalledQueueCount\(!loading\);/);
    expect(admin).toMatch(/adminBadgeFor\(id, unreadCounts, stats, openQueues\)/);
    expect(rail).toMatch(/rpc\("admin_stalled_job_queue", \{ p_include_resolved: false \}\)/);
    // Test jobs stay out, like every other rail count (lh-silent-failure review).
    expect(rail).toMatch(/fetchSeedUserIds\(rows\.flatMap\(\(r\) => \[r\.customer_id, r\.helper_id\]\)\)/);
  });

  it("every queue row without a badge is in the known list", () => {
    const missing = queueRows.filter((id) => !hasBadge(id) && !KNOWN_NO_BADGE.includes(id));
    expect(missing, "a queue row with no rail count").toEqual([]);
  });

  it("the known list holds no row that has a badge now, or left the rail (two-way)", () => {
    const stale = KNOWN_NO_BADGE.filter((id) => !queueRows.includes(id) || hasBadge(id)).map(
      (id) => `stale baseline entry ${id} — remove it (lower the baseline)`,
    );
    expect(stale).toEqual([]);
  });
});
