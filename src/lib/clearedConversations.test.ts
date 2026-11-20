/**
 * "Delete for me" (20261120201223, owner-approved polish 2026-11-20): the client
 * half. A clear hides every message up to its moment from the member only, a
 * newer message brings the thread back with only what came after, the inbox and
 * the nav badge read the same rule (groupThreads), a failed write rolls back,
 * and restoring an archive of a cleared thread keeps the clear.
 *
 * @mutate src/lib/unreadConversations.ts |     if (isClearedMessage(uid, m.job_id, other, m.created_at)) continue; |     if (false) continue;
 * @mutate src/lib/clearedConversations.ts |   return Number.isFinite(at) && Number.isFinite(cut) ? at <= cut : false; |   return Number.isFinite(at) && Number.isFinite(cut) ? at < cut : false;
 * @mutate src/lib/archivedConversations.ts |   if (cleared) map[key] = cleared; |   if (false) map[key] = cleared;
 * @mutate src/lib/archivedConversations.ts |   setClearMap(userId, rollClear); |   void rollClear;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const update = vi.fn();
const del = vi.fn();
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  // A chainable filter: .eq / .is return itself and it resolves to { error: null }.
  const chain = (result: { error: unknown }) => {
    const c: Record<string, unknown> = {};
    c.eq = () => c;
    c.is = () => c;
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
    return c;
  };
  return {
    supabase: {
      from: () => ({
        upsert: (...a: unknown[]) => upsert(...a),
        update: (...a: unknown[]) => { update(...a); return chain({ error: null }); },
        delete: () => { del(); return chain({ error: null }); },
      }),
    },
  };
});

import { deleteConversationForMe, isArchived, unarchiveConversation, archiveConversation } from "@/lib/archivedConversations";
import { clearedBefore, isClearedMessage } from "@/lib/clearedConversations";
import { groupThreads, unreadConversationCount } from "@/lib/unreadConversations";
import { teamThreadKey } from "@/lib/teamThread";

const ME = "11111111-1111-1111-1111-111111111111";
const THEM = "22222222-2222-2222-2222-222222222222";
const JOB = "33333333-3333-3333-3333-333333333333";

beforeEach(() => {
  upsert.mockReset();
  update.mockReset();
  del.mockReset();
});

describe("delete for me", () => {
  it("hides every message up to the clear from me (inbox and badge alike), and a newer one reappears", async () => {
    upsert.mockResolvedValue({ error: null });
    const old = { job_id: JOB, sender_id: THEM, receiver_id: ME, created_at: "2020-01-01T00:00:00.000Z", read: false };
    expect(unreadConversationCount([old], ME, new Set())).toBe(1);

    const ok = await deleteConversationForMe(ME, JOB, THEM);
    expect(ok).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(1);
    const row = upsert.mock.calls[0][0] as Record<string, string>;
    expect(row.user_id).toBe(ME);
    expect(row.cleared_before).toBe(row.archived_at);
    expect(clearedBefore(ME, JOB, THEM)).toBe(row.cleared_before);
    // The thread hides at once, and nothing in it is mine any more.
    expect(isArchived(ME, JOB, THEM, old.created_at)).toBe(true);
    expect(isClearedMessage(ME, JOB, THEM, old.created_at)).toBe(true);
    expect(groupThreads([old], ME).size).toBe(0);
    expect(unreadConversationCount([old], ME, new Set())).toBe(0);
    // Only my side: the other person's grouping of the same row is untouched.
    expect(groupThreads([old], THEM).size).toBe(1);

    const fresh = { ...old, created_at: new Date(Date.now() + 60_000).toISOString() };
    const groups = [...groupThreads([fresh, old], ME).values()];
    expect(groups).toHaveLength(1);
    expect(groups[0].messages).toEqual([fresh]);
    expect(unreadConversationCount([fresh, old], ME, new Set())).toBe(1);
    expect(isArchived(ME, JOB, THEM, fresh.created_at)).toBe(false);
  });

  it("a refused write rolls the clear back and says so", async () => {
    const job2 = "44444444-4444-4444-4444-444444444444";
    upsert.mockResolvedValue({ error: { code: "42501", message: "denied" } });
    const ok = await deleteConversationForMe(ME, job2, THEM);
    expect(ok).toBe(false);
    expect(clearedBefore(ME, job2, THEM)).toBeNull();
    expect(isArchived(ME, job2, THEM, "2020-01-01T00:00:00.000Z")).toBe(false);
  });

  it("restoring a cleared thread that was archived again keeps the clear (update, never delete)", async () => {
    const job3 = "55555555-5555-5555-5555-555555555555";
    upsert.mockResolvedValue({ error: null });
    await deleteConversationForMe(ME, job3, THEM);
    const cut = clearedBefore(ME, job3, THEM)!;
    await new Promise((r) => setTimeout(r, 5));
    archiveConversation(ME, job3, THEM);
    unarchiveConversation(ME, job3, THEM);
    await new Promise((r) => setTimeout(r, 0));
    expect(del).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ archived_at: cut });
    expect(clearedBefore(ME, job3, THEM)).toBe(cut);
    // A message after the clear is visible again; one before it is not.
    expect(isArchived(ME, job3, THEM, new Date(Date.now() + 60_000).toISOString())).toBe(false);
    expect(isClearedMessage(ME, job3, THEM, "2020-01-01T00:00:00.000Z")).toBe(true);
  });

  it("a Team thread is never cleared", async () => {
    expect(await deleteConversationForMe(ME, teamThreadKey(ME), THEM)).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });
});
