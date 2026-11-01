/**
 * JA-36 (audit 11-01): Home's Coming up said "Nothing booked yet." right under Next up's live job ("Your Helpr is on
 * the way"). Something IS booked: a booked job that is live or under way is not in Coming up, so the empty line says
 * "Nothing else booked." whenever the member has a booked job on either side.
 *
 * @mutate src/pages/home/homeDashboard/useHomeSummary.ts |   return postedJobs.some((j) => BOOKED_STATUSES.has(j.status) && (!!j.helper_id \|\| j.is_group_job === true)) |   return false
 * @mutate src/pages/home/HomeDashboard.tsx | {summary.hasBookedJob ? "Nothing else booked." : "Nothing booked yet."} | Nothing booked yet.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { hasBookedJob } from "@/pages/home/homeDashboard/useHomeSummary";

describe("Coming up's empty line knows a job is booked (JA-36)", () => {
  it("a booked job of mine, either side, counts; open, finished and someone else's do not", () => {
    expect(hasBookedJob([{ status: "accepted", helper_id: "h" }], [])).toBe(true);
    expect(hasBookedJob([{ status: "in_progress", helper_id: null, is_group_job: true }], [])).toBe(true);
    expect(hasBookedJob([], [{ helper_id: "me", job: { status: "in_progress", helper_id: "me" } }])).toBe(true);
    expect(hasBookedJob([{ status: "open", helper_id: null }, { status: "completed", helper_id: "h" }], [])).toBe(false);
    expect(hasBookedJob([], [{ helper_id: "me", job: { status: "accepted", helper_id: "someone-else" } }])).toBe(false);
  });

  it("Home reads it for the empty line", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../pages/home/HomeDashboard.tsx"), "utf8"));
    const empties = src.match(/data-testid="coming-up-empty"[^\n]*/g) ?? [];
    expect(empties.length).toBeGreaterThan(0);
    for (const e of empties) expect(e).toContain('{summary.hasBookedJob ? "Nothing else booked." : "Nothing booked yet."}');
  });
});
