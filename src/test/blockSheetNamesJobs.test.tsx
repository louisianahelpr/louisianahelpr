/**
 * Q2675 + Q2676 (audit 1102e rows 8 and 9): the block sheet counted "2 active jobs between you will be cancelled" and
 * never named them, and told everyone "They won't be able to apply to your jobs", the poster's seat only (a Helpr
 * blocking a poster read words about their own jobs). Now the jobs are named and the line covers both seats.
 * The strike words follow the server (migration 20261102131745, lead 11-02): a poster's block is a strike only inside
 * 24 hours; a hired Helpr's block is their strike only inside 24 hours, the same as cancelling, and costs the poster
 * nothing.
 * @mutate src/components/BlockUserDialog.tsx | most of your payment comes back to you, and it isn&rsquo;t a strike. | most of your payment comes back to you, but a cancellation strike is still recorded on your account.
 * @mutate src/components/BlockUserDialog.tsx |       setIsHelprOnAny(rows.some((r) => r.helper_id === user.id)); |       setIsHelprOnAny(false);
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

  it("the poster's strike words follow the 24-hour rule (Q2675)", async () => {
    // Committed, 3 days out: no fee, no strike.
    rows.push(job({ title: "Mow", date_needed: jobLocalDateISO(3, NOW), start_time: "12:00:00", helper_confirmed_at: "2026-09-20T12:00:00Z" }));
    open();
    const far = await liText(/will be cancelled/);
    expect(far).toMatch(/and it isn.t a strike\./);
    expect(far).not.toMatch(/strike is still recorded/);
  });

  it("inside 24 hours the poster reads the amount and the strike", async () => {
    rows.push(job({ title: "Mow", helper_confirmed_at: "2026-09-20T12:00:00Z" }));
    open();
    expect(await liText(/will be cancelled/)).toMatch(/is for your Helpr.s time, most of the rest of your payment comes back to you, and it counts as a strike\./);
  });

  it("the hired Helpr reads their own rule, never the poster's (Q2676)", async () => {
    rows.push(job({ customer_id: "helper-1", helper_id: "poster-1", title: "Mow", helper_confirmed_at: "2026-09-20T12:00:00Z" }));
    open();
    const t = await liText(/will be cancelled/);
    expect(t).toContain("For a job you were hired for, it counts as a strike if it starts within 24 hours, the same as cancelling.");
    expect(t).not.toMatch(/your Helpr.s time/);
  });

  it("the who-can-reach-you line is true from either seat", async () => {
    rows.push(job({ customer_id: "helper-1", helper_id: "poster-1", title: "Mow" }));
    open();
    const line = await liText(/message you/);
    expect(line).toBe("They can't apply to your jobs, offer you a job, or message you.");
  });
});
