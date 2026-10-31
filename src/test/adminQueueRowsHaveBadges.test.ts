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
 *
 * Q1691 (2026-10-14): Ban Review, License & Insurance, Exception Queue, Fraud
 * and Identity Review now count what their screens list as waiting, from the
 * same reads, test accounts left out.
 * @mutate src/components/admin/adminRailBadges.ts |   if (id === "fraud" && (openQueues.fraud ?? 0) > 0) return openQueues.fraud; |
 * @mutate src/components/admin/adminRailBadges.ts |   return userIds.filter((id): id is string => !!id && !seed.has(id)); |   return userIds.filter((id): id is string => !!id);
 * @mutate src/components/admin/adminRailBadges.ts |       return rows.filter((r) => r.is_seed !== true).length; |       return rows.length;
 * @mutate src/components/admin/adminRailBadges.ts | () => ({ ...queues.data, stalled: stalled.data, | () => ({ stalled: stalled.data,
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adminNavGroups } from "@/components/admin/adminNavGroups";
import { adminBadgeFor } from "@/components/admin/adminRailBadges";
import { blankComments } from "./helpers/blankNonCode";

// Q1653: queues still without a rail count. Empty since Q1691 (2026-10-14) gave
// the last five (banreview, credentials, exceptions, fraud, idvreview) a count.
// @two-way src/test/adminQueueRowsHaveBadges.test.ts:stale baseline entry ${id} — remove it (lower the baseline)
const KNOWN_NO_BADGE: string[] = [];

const admin = blankComments(readFileSync(join(process.cwd(), "src/pages/admin/Admin.tsx"), "utf8"));
const rail = blankComments(readFileSync(join(process.cwd(), "src/components/admin/adminRailBadges.ts"), "utf8"));
const badgeFor = rail.slice(rail.indexOf("function adminBadgeFor("), rail.indexOf("function useStalledQueueCount("));
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
    // Admin.tsx mounts every queue count (useAdminPendingCounts, which reads
    // the stalled count) and feeds it to the rail.
    expect(admin).toMatch(/const pendingCounts = useAdminPendingCounts\(!loading\);/);
    expect(rail).toMatch(/const stalled = useStalledQueueCount\(enabled\);/);
    expect(admin).toMatch(/adminBadgeFor\(id, unreadCounts, openQueues\)/);
    expect(rail).toMatch(/rpc\("admin_stalled_job_queue", \{ p_include_resolved: false \}\)/);
    // Test jobs stay out, like every other rail count (lh-silent-failure review).
    expect(rail).toMatch(/fetchSeedUserIds\(rows\.flatMap\(\(r\) => \[r\.customer_id, r\.helper_id\]\)\)/);
  });

  it("every queue row without a badge is in the known list", () => {
    const missing = queueRows.filter((id) => !hasBadge(id) && !KNOWN_NO_BADGE.includes(id));
    expect(missing, "a queue row with no rail count").toEqual([]);
  });

  it("Q1691: each of the five queues returns its own open count, and none when zero", () => {
    const counts = { banreview: 1, credentials: 2, exceptions: 3, fraud: 4, idvreview: 5 };
    for (const [id, n] of Object.entries(counts)) {
      expect(adminBadgeFor(id, {}, counts), id).toBe(n);
      expect(adminBadgeFor(id, {}, { [id]: 0 }), `${id} at zero`).toBeUndefined();
    }
    const hook = rail.slice(rail.indexOf("export function useAdminPendingCounts("));
    expect(hook).toMatch(/const queues = useOpenQueueCounts\(enabled\);/);
    expect(hook).toMatch(/\(\) => \(\{ \.\.\.queues\.data, stalled: stalled\.data,/);
    expect(admin).toMatch(/const openQueues = pendingCounts\.data;/);
    expect(admin).toMatch(/pendingCounts\.isError \|\| seriousAlertsFailed/);
  });

  it("Q1691: the counts read each screen's own source and leave test accounts out", () => {
    const hook = rail.slice(rail.indexOf("function useOpenQueueCounts("), rail.indexOf("async function fetchOpenDisputeCount("));
    expect(hook.length).toBeGreaterThan(500);
    // Same reads as AdminBanReview, AdminExceptionQueue, AdminFraudDashboard,
    // AdminCredentialQueue and AdminIDVReview.
    expect(hook).toMatch(/\.from\("user_violations"\)\.select\("user_id"\)\.eq\("action_taken", "pending_ban_review"\)/);
    expect(hook).toMatch(/new Set\(await realUsers\(/); // one case per person
    expect(hook).toMatch(/\.from\("verification_exceptions"\)\.select\("user_id"\)\.eq\("status", "open"\)/);
    expect(hook).toMatch(/\.from\("fraud_flags"\)\.select\("user_id"\)\.eq\("resolved", false\)/);
    expect(hook).toMatch(/supabase\.rpc\("get_pending_credentials"\)/);
    expect(hook).toMatch(/\.eq\("idv_status", "manual_review"\)/);
    expect(hook).toMatch(/rows\.filter\(\(r\) => r\.is_seed !== true\)\.length/);
    // Test accounts out (fetchSeedUserIds), a failed read throws (unwrap).
    expect(rail).toMatch(/return userIds\.filter\(\(id\): id is string => !!id && !seed\.has\(id\)\);/);
    expect((hook.match(/realUsers\(/g) ?? []).length).toBe(4);
    expect((hook.match(/unwrap\(/g) ?? []).length).toBe(5);
    // Each key under its screen's prefix, so the screen's refresh moves the number.
    for (const key of ["admin-ban-review", "admin-credential-queue", "admin-exception-queue", "admin-fraud-flags", "admin-idv-review"]) {
      expect(hook).toContain(`queryKey: ["${key}", "rail-count"]`);
    }
  });

  it("the known list holds no row that has a badge now, or left the rail (two-way)", () => {
    const stale = KNOWN_NO_BADGE.filter((id) => !queueRows.includes(id) || hasBadge(id)).map(
      (id) => `stale baseline entry ${id} — remove it (lower the baseline)`,
    );
    expect(stale).toEqual([]);
  });
});
