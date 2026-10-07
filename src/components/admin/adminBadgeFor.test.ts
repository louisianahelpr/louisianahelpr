/**
 * Q1071: the Stuck Jobs rail item badges the jobs awaiting a person.
 *
 * @mutate src/components/admin/adminBadgeFor.ts |   if (id === "stalled" && stalledOpen > 0) return stalledOpen; |
 */
import { describe, it, expect } from "vitest";
import { adminBadgeFor } from "./adminBadgeFor";
import type { Stats } from "@/components/admin/dashboard/types";

const stats = { disputedJobs: 0, openReports: 0, supportTickets: 0 } as unknown as Stats;

describe("adminBadgeFor (Q1071)", () => {
  it("Stuck Jobs shows how many jobs await a person, and nothing at zero", () => {
    expect(adminBadgeFor("stalled", {}, stats, 3)).toBe(3);
    expect(adminBadgeFor("stalled", {}, stats, 0)).toBeUndefined();
  });
  it("the other queues are unchanged", () => {
    expect(adminBadgeFor("disputes", {}, { ...stats, disputedJobs: 2 } as Stats, 3)).toBe(2);
    expect(adminBadgeFor("people", { people: 4 }, stats, 3)).toBe(4);
  });
});
