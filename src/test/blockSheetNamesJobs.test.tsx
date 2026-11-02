/**
 * Q2675 + Q2676 (audit 1102e rows 8 and 9): the block sheet counted "2 active jobs between you will be cancelled" and
 * never named them, and told everyone "They won't be able to apply to your jobs", the poster's seat only (a Helpr
 * blocking a poster read words about their own jobs). Now the jobs are named and the line covers both seats.
 * The strike half of row 8 (block_user_and_settle files the poster's strike at any distance from the start, while
 * poster_cancel_job files it only inside 24 hours) is a server rule; it waits on a lead verdict (Q2675).
 *
 * @mutate src/components/BlockUserDialog.tsx | will be cancelled{jobTitles.length > 0 ? `: ${jobTitles.map((t) => `"${t}"`).join(", ")}` : ""}. | will be cancelled.
 * @mutate src/components/BlockUserDialog.tsx | They can&apos;t apply to your jobs, offer you a job, or message you. | They won&apos;t be able to apply to your jobs or message you.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const rows: Array<Record<string, unknown>> = [];
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/userBlocks", () => ({ blockUser: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: { id: "poster-1" } } })) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        or: vi.fn(() => ({
          // Awaitable as is (all rows) AND narrowable by .is(col, null), so
          // dropping the server's helper_completed_at filter is visible.
          in: vi.fn(() => ({
            then: (res: (v: unknown) => unknown) => res({ data: rows, error: null }),
            is: vi.fn((col: string, val: null) =>
              Promise.resolve({ data: rows.filter((r) => (r[col] ?? null) === val), error: null }),
            ),
          })),
        })),
      })),
    })),
  },
}));

import { BlockUserDialog } from "@/components/BlockUserDialog";

// "Now" is pinned to 2026-09-27 12:00Z (07:00 Chicago). A job dated 09-26
// started yesterday: the 50% top tier for a committed Helpr.
// Job days are derived from NOW, never typed (jobDayFixtureTimezone).
const NOW = new Date("2026-09-27T12:00:00Z");
function job(overrides: Record<string, unknown>) {
  return {
    id: "job-1",
    budget: 100,
    date_needed: jobLocalDateISO(-1, NOW),
    start_time: null,
    customer_id: "poster-1",
    helper_id: "helper-1",
    helper_confirmed_at: null,
    ...overrides,
  };
}
function open() {
  render(<BlockUserDialog open onClose={vi.fn()} blockedUserId="helper-1" blockedUserName="Marie" />);
}
const liText = async (re: RegExp) =>
  (await screen.findByText((_, el) => el?.tagName === "LI" && re.test(el.textContent ?? ""))).textContent ?? "";

beforeEach(() => {
  rows.length = 0;
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});
afterEach(() => vi.useRealTimers());

describe("the block sheet names the jobs and speaks to both seats (Q2675, Q2676)", () => {
  it("names every job that will be cancelled", async () => {
    rows.push(job({ id: "a", title: "Rake the front yard" }), job({ id: "b", title: "Haul off a couch", helper_confirmed_at: "2026-09-20T12:00:00Z" }));
    open();
    const text = await liText(/will be cancelled/);
    expect(text).toContain('2 active jobs between you will be cancelled: "Rake the front yard", "Haul off a couch".');
  });

  it("the who-can-reach-you line is true from either seat", async () => {
    rows.push(job({ customer_id: "helper-1", helper_id: "poster-1", title: "Mow" }));
    open();
    const line = await liText(/message you/);
    expect(line).toBe("They can't apply to your jobs, offer you a job, or message you.");
  });
});
