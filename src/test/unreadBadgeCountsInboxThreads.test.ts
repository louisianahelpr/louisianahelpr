/**
 * THE MESSAGES BADGE COUNTS THE INBOX'S UNREAD THREADS (lead decision 2026-10-31, NOID-20 "unread counts disagree").
 * Measured from source by B43: the nav badge (useNavUnreadCount) counted unread received MESSAGES up to 1000, while
 * the inbox (fetchConversations) built its threads from only the newest 200 messages and marked threads. So three
 * unread messages in one thread read "3" beside one marked thread, and an unread message older than the newest 200
 * lifted the badge while no inbox thread showed it. Both now read src/lib/unreadConversations.ts.
 * The check drives the REAL hook and the REAL inbox loader over the same message rows (the unread rows answer the
 * unread query, a newest-200 window that holds none of the older unread rows answers the inbox's window query) and
 * asserts: badge === the number of inbox threads with unread > 0, and every unread thread is in the inbox.
 *
 * @mutate src/components/mobileNav/useNavUnreadCount.ts |     const next = unreadConversationCount((data ?? []) as unknown as Parameters<typeof unreadConversationCount>[0], userId, blockedSet); |     const next = (data ?? []).length;
 * @mutate src/pages/messages/messagesData/loadConversations.ts |   const msgs = [...windowRows, ...olderUnread] |   const msgs = [...windowRows]
 * @mutate src/lib/unreadConversations.ts |     if (threadUnread(t.messages, uid) === 0) continue; |
 * @mutate src/lib/unreadConversations.ts |     if (isArchived(uid, t.jobId, t.otherUserId, lastAt)) continue; |
 * @mutate src/lib/unreadConversations.ts |   if (m.flagged_hidden && m.sender_id !== uid) return false; |
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { User } from "@supabase/supabase-js";

const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const BEN = "aaaaaaaa-0000-4000-8000-000000000002";
const CAL = "aaaaaaaa-0000-4000-8000-000000000003";
const DEE = "aaaaaaaa-0000-4000-8000-000000000004"; // blocked
const STAFF1 = "aaaaaaaa-0000-4000-8000-000000000005";
const STAFF2 = "aaaaaaaa-0000-4000-8000-000000000006";

let n = 0;
const row = (o: Record<string, unknown>) => ({
  id: `m${++n}`, job_id: "job-1", sender_id: BEN, receiver_id: ME, content: "hi", read: false, is_system: false,
  flagged_hidden: false, team_thread_user_id: null, attachment_url: null, attachment_mime: null,
  created_at: "2026-10-30T10:00:00.000Z", ...o,
});

// Unread rows to ME: 3 in Ben's job-1 thread, 1 OLD one in Cal's job-2 thread (outside the newest-200 window),
// 2 from two staff in ONE Team thread, plus rows the inbox hides: a blocked sender, a server-hidden one, a system row.
const UNREAD = [
  row({ created_at: "2026-10-30T12:00:00.000Z" }),
  row({ created_at: "2026-10-30T11:00:00.000Z" }),
  row({ created_at: "2026-10-30T10:00:00.000Z" }),
  row({ job_id: "job-2", sender_id: CAL, created_at: "2026-01-02T10:00:00.000Z" }),
  row({ job_id: null, sender_id: STAFF1, team_thread_user_id: ME, created_at: "2026-10-29T10:00:00.000Z" }),
  row({ job_id: null, sender_id: STAFF2, team_thread_user_id: ME, created_at: "2026-10-29T09:00:00.000Z" }),
  row({ job_id: "job-3", sender_id: DEE, created_at: "2026-10-29T08:00:00.000Z" }),
  row({ job_id: "job-4", sender_id: CAL, flagged_hidden: true, created_at: "2026-10-29T07:00:00.000Z" }),
];
// The newest-200 window: Ben's unread rows and the Team rows, plus read traffic; NOT Cal's old unread row.
const WINDOW = [
  ...UNREAD.filter((m) => m.job_id !== "job-2"),
  row({ job_id: "job-5", sender_id: ME, receiver_id: CAL, read: true, created_at: "2026-10-28T10:00:00.000Z" }),
];

vi.mock("@/lib/userBlocks", () => ({ getBlockedUserIds: () => Promise.resolve(new Set([DEE])) }));
vi.mock("@/lib/userRealtimeBus", () => ({ subscribeUserRealtime: () => () => {} }));
vi.mock("@/components/mobileNav/mobileNavHelpers", () => ({ readCachedUnread: () => 0, writeCachedUnread: () => {} }));
vi.mock("@/lib/appBadge", () => ({ setAppIconBadge: () => Promise.resolve() }));
vi.mock("@/lib/messageAttachments", () => ({ getMessageAttachmentSignedUrls: async () => ({}), isImageMime: () => false, getMessageAttachmentSignedUrl: async () => null }));
vi.mock("@/lib/threadMutes", () => ({ getMutedThreadMap: async () => new Map(), threadMuteKey: (j: string, o: string) => `${j}_${o}` }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const eqs: Array<[string, unknown]> = [];
    const b: Record<string, unknown> = {};
    for (const m of ["select", "or", "order", "limit", "in", "not", "update", "maybeSingle", "gte", "is", "neq", "upsert", "delete"]) b[m] = () => b;
    b.eq = (c: string, v: unknown) => { eqs.push([c, v]); return b; };
    b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      let data: unknown = [];
      if (table === "messages") data = eqs.some(([c, v]) => c === "read" && v === false) ? UNREAD : WINDOW;
      if (table === "jobs") data = ["job-1", "job-2", "job-3", "job-4", "job-5"].map((id) => ({ id, title: `Job ${id}`, status: "open", customer_id: ME }));
      return Promise.resolve({ data, error: null, count: 0 }).then(ok, bad);
    };
    return b;
  };
  return { supabase: { from: (t: string) => builder(t), rpc: async () => ({ data: [], error: null }), channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: () => {} } };
});

import { useNavUnreadCount } from "@/components/mobileNav/useNavUnreadCount";
import { fetchConversations } from "@/pages/messages/messagesData/loadConversations";
import { archiveConversation } from "@/lib/archivedConversations";
import { unreadConversationCount } from "@/lib/unreadConversations";

beforeEach(() => {
  localStorage.clear();
});

async function badge(): Promise<number> {
  const { result, unmount } = renderHook(() => useNavUnreadCount({ id: ME } as User));
  let v = -1;
  await waitFor(() => {
    v = result.current.unreadCount;
    expect(v).toBeGreaterThan(0);
  });
  unmount();
  return v;
}

describe("the Messages badge counts the inbox's unread threads, from one source (NOID-20)", () => {
  it("badge = the inbox threads with an unread message, and every unread thread is in the inbox", async () => {
    const convos = await fetchConversations(ME, { current: false });
    const unreadThreads = convos.filter((c) => c.unread > 0);
    // Ben's job-1 (3 unread = ONE thread), Cal's OLD job-2 row (outside the window), the Team thread (two staff, one thread).
    expect(unreadThreads.map((c) => c.jobId).sort()).toEqual(["job-1", "job-2", `team:${ME}`].sort());
    expect(convos.find((c) => c.jobId === "job-1")?.unread).toBe(3);
    // The blocked sender and the server-hidden row never reach the inbox.
    expect(convos.some((c) => c.jobId === "job-3" || c.jobId === "job-4")).toBe(false);
    expect(await badge()).toBe(unreadThreads.length);
  });

  it("over any rows that hold every unread one (the inbox's own list), a thread with only read messages is not counted", () => {
    // WINDOW + the old unread row: the read-only job-5 thread is there and must not count.
    expect(unreadConversationCount([...WINDOW, UNREAD[3]], ME, new Set([DEE]))).toBe(3);
  });

  it("an archived thread leaves the badge as it leaves the inbox", async () => {
    archiveConversation(ME, "job-1", BEN);
    expect(await badge()).toBe(2);
  });
});
