/*
 * Sentry JAVASCRIPT-2K (2026-09-25): a thread pinned on the device whose job
 * was later deleted can never be stored (thread_pins_job_id_fkey, 23503).
 * loadPins pushed every local-only pin in ONE upsert, so that single dead pin
 * failed the batch, was reported on every inbox load, kept every live local
 * pin from syncing, and stayed in the mirror forever.
 *
 * @mutate src/lib/pinnedConversations.ts | if (isGonePin(rowError)) gone.add(pinnedKey(row.job_id, row.other_user_id)); | if (isGonePin(rowError)) void 0;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const LIVE_JOB = "11111111-aaaa-4aaa-8aaa-000000000001";
const GONE_JOB = "11111111-aaaa-4aaa-8aaa-000000000002";
const OTHER = "22222222-bbbb-4bbb-8bbb-000000000001";
const ME = "33333333-cccc-4ccc-8ccc-000000000001";

const upserts: Array<Array<{ job_id: string }>> = [];
const reportMock = vi.fn();

vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => reportMock(...a) }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: async () => ({ data: [], error: null }) }),
      upsert: async (rows: Array<{ job_id: string }>) => {
        upserts.push(rows);
        const fk = rows.some((r) => r.job_id === GONE_JOB);
        return {
          error: fk
            ? { code: "23503", message: 'insert or update on table "thread_pins" violates foreign key constraint "thread_pins_job_id_fkey"' }
            : null,
        };
      },
    }),
  },
}));

describe("loadPins merge-up survives a pin to a deleted job (JAVASCRIPT-2K)", () => {
  beforeEach(() => {
    upserts.length = 0;
    reportMock.mockReset();
    localStorage.clear();
    vi.resetModules();
  });

  it("keeps and syncs the live pin, drops the dead one, and reports nothing", async () => {
    const { loadPins, pinnedKey } = await import("./pinnedConversations");
    localStorage.setItem(
      `helpr_pinned_threads_v2_${ME}`,
      JSON.stringify([pinnedKey(LIVE_JOB, OTHER), pinnedKey(GONE_JOB, OTHER)]),
    );

    const pins = await loadPins(ME);

    expect([...pins]).toEqual([pinnedKey(LIVE_JOB, OTHER)]);
    expect(upserts.some((b) => b.length === 1 && b[0].job_id === LIVE_JOB), "the live pin is pushed on its own").toBe(true);
    expect(reportMock).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(`helpr_pinned_threads_v2_${ME}`) ?? "[]")).toEqual([
      pinnedKey(LIVE_JOB, OTHER),
    ]);
  });

  it("the next load does not push the dead pin again", async () => {
    const { loadPins, pinnedKey } = await import("./pinnedConversations");
    localStorage.setItem(`helpr_pinned_threads_v2_${ME}`, JSON.stringify([pinnedKey(GONE_JOB, OTHER)]));
    await loadPins(ME);
    upserts.length = 0;
    await loadPins(ME);
    expect(upserts).toEqual([]);
  });
});
