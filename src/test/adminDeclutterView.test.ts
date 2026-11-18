/**
 * Design audit area 10 #2 (11-18): Declutter has its own row under Queues with a badge (open problems plus shipping
 * claims due, test accounts left out), and Admin.tsx renders AdminDeclutter for it.
 *
 * @mutate src/components/admin/adminRailBadges.ts |   if (id === "declutter" && (openQueues.declutter ?? 0) > 0) return openQueues.declutter;\n |
 * @mutate src/components/admin/adminRailBadges.ts |       return (await m.fetchOpenProblemsWithDetail(false)).length; |       return (await m.fetchOpenProblemsWithDetail(true)).length;
 * @mutate src/components/admin/adminRailBadges.ts |       return (await withoutTestPeople(rows, (r) => [r.seller_id])).length; |       return rows.length;
 * @mutate src/pages/admin/Admin.tsx |       case "declutter": return <AdminDeclutter />; |       case "declutter": return null;
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adminNavGroups } from "@/components/admin/adminNavGroups";
import { ADMIN_QUEUE_IDS, adminBadgeFor } from "@/components/admin/adminRailBadges";
import { blankComments } from "./helpers/blankNonCode";

const read = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));

describe("Declutter admin view under Queues (design audit area 10 #2)", () => {
  it("is a Queues row with an open-count badge", () => {
    const queues = adminNavGroups.find((g) => g.title === "Queues")?.items.map((i) => i.id) ?? [];
    expect(queues.length).toBeGreaterThan(3);
    expect(queues).toContain("declutter");
    expect(ADMIN_QUEUE_IDS).toContain("declutter");
    expect(adminBadgeFor("declutter", {}, { declutter: 3 })).toBe(3);
    expect(adminBadgeFor("declutter", { declutter: 9 }, { declutter: 0 })).toBeUndefined();
  });

  it("counts real open problems plus claims due, test accounts left out", () => {
    const rail = read("src/components/admin/adminRailBadges.ts");
    const hook = rail.slice(rail.indexOf("function useDeclutterQueueCount("), rail.indexOf("export function useAdminPendingCounts("));
    expect(hook.length).toBeGreaterThan(400);
    expect(hook).toMatch(/fetchOpenProblemsWithDetail\(false\)/);
    expect(hook).toMatch(/rpc\("declutter_admin_ship_claims_due"\)/);
    expect(hook).toMatch(/withoutTestPeople\(rows, \(r\) => \[r\.seller_id\]\)/);
    expect(rail).toMatch(/declutter: declutter\.data/);
  });

  it("Admin.tsx renders the view", () => {
    expect(read("src/pages/admin/Admin.tsx")).toMatch(/case "declutter": return <AdminDeclutter \/>;/);
  });
});
