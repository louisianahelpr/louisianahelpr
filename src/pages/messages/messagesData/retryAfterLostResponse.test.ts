// Q268 — "Tap to Retry" on a message whose RESPONSE was lost sent it twice.
//
// The first INSERT reached the server and was stored; only the answer was
// lost on the wire, so the bubble went "failed". Tapping it re-ran the INSERT
// with nothing that identified it as the same message, and the thread held
// the text twice. e2e/slow-network/slow-network.spec.ts `message · drop`
// drives this against prod; this is the same scenario at the client-write
// layer, against a fake `messages` table that enforces exactly the migration's
// UNIQUE (sender_id, client_id) WHERE client_id IS NOT NULL
// (20260923181707_idempotent_job_post_and_message_send.sql).
//
// Red first (2026-09-23): against the pre-fix sendHandlers.ts (no client_id
// in the INSERT) the table held 2 rows and the bubble stayed "failed".
//
// @mutate src/pages/messages/messagesData/sendHandlers.ts | { client_id: optimistic.clientId } | {}
// @mutate src/pages/messages/messagesData/sendHandlers.ts | if (error && (error as { code?: string }).code === "23505" && optimistic.clientId) { | if (false) {

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Conversation, Message } from "@/components/messages/types";

type Row = Record<string, unknown>;
const server = vi.hoisted(() => ({
  rows: [] as Row[],
  loseNextResponse: false,
  inserts: 0,
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = () => {
    const filters: Array<[string, unknown]> = [];
    let pending: Row | null = null;
    const run = (): { data: Row | null; error: unknown } => {
      if (pending) {
        server.inserts += 1;
        const row = pending;
        const clash =
          row.client_id != null &&
          server.rows.some((r) => r.sender_id === row.sender_id && r.client_id === row.client_id);
        if (clash) {
          return {
            data: null,
            error: { code: "23505", message: 'duplicate key value violates unique constraint "messages_sender_client_id_key"' },
          };
        }
        const stored = { id: `srv-${server.rows.length + 1}`, created_at: "2026-09-23T00:00:00.000Z", read: false, ...row };
        server.rows.push(stored);
        if (server.loseNextResponse) {
          server.loseNextResponse = false;
          return { data: null, error: { code: "", message: "TypeError: Failed to fetch" } };
        }
        return { data: stored, error: null };
      }
      const hit = server.rows.filter((r) => filters.every(([k, v]) => r[k] === v));
      return { data: hit[0] ?? null, error: null };
    };
    const chain: Record<string, unknown> = {
      insert: (row: Row) => { pending = row; return chain; },
      select: () => chain,
      eq: (k: string, v: unknown) => { filters.push([k, v]); return chain; },
      single: () => Promise.resolve(run()),
      maybeSingle: () => Promise.resolve(run()),
    };
    return chain;
  };
  return { supabase: { from, rpc: vi.fn() } };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn() }));
vi.mock("@/lib/requireOnline", () => ({ requireOnline: () => true }));
vi.mock("@/lib/messagingLockout", () => ({
  threadClosedCopy: () => ({ toast: "closed" }),
  fetchMessagingClosesAt: async () => new Map(),
  isLockoutRefusal: () => false,
}));
vi.mock("@/lib/recipientGate", () => ({
  RECIPIENT_RESTRICTED_TOAST: "restricted",
  fetchRecipientRestricted: async () => false,
}));

import { createSendHandlers } from "./sendHandlers";

const CONVO: Conversation = {
  otherUserId: "helper-1",
  otherUserName: "Dana R.",
  jobTitle: "Fix the fence",
  jobId: "job-1",
  lastMessage: "",
  lastAt: "2026-09-23T00:00:00.000Z",
  unread: 0,
};

function harness() {
  let state: Message[] = [];
  const setMessages = (u: Message[] | ((p: Message[]) => Message[])) => {
    state = typeof u === "function" ? u(state) : u;
  };
  const handlers = () =>
    createSendHandlers({
      userId: "poster-1",
      cachedUser: null,
      activeConvo: CONVO,
      messages: state,
      warningShown: false,
      setWarningShown: vi.fn(),
      setMessages: setMessages as never,
      setConversations: vi.fn(),
      scrollToBottom: vi.fn(),
      activeConvoRef: { current: CONVO },
      loadConversations: vi.fn(async () => {}),
    });
  return { handlers, messages: () => state };
}

beforeEach(() => {
  server.rows = [];
  server.loseNextResponse = false;
  server.inserts = 0;
});

describe("Q268: Tap to Retry after a lost response writes the message once", () => {
  it("the retry resends the same key, the server refuses the copy, and the bubble shows as sent", async () => {
    const h = harness();
    server.loseNextResponse = true;
    await h.handlers().sendMessage("On my way");

    // The first INSERT landed; the client only saw the transport failure.
    expect(server.rows).toHaveLength(1);
    const failed = h.messages().find((m) => m.sendStatus === "failed");
    expect(failed, "a lost response must leave a retryable bubble").toBeTruthy();

    await h.handlers().retryMessage(failed!.clientId!);

    expect(server.inserts).toBe(2); // the retry really did reach the server
    expect(server.rows, "Tap to Retry wrote the message a second time").toHaveLength(1);
    const bubbles = h.messages().filter((m) => m.content === "On my way");
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].sendStatus, "the bubble still says failed for a message that was delivered").not.toBe("failed");
    expect(bubbles[0].id).toBe("srv-1");
  });

  it("two different sends of the same text are still two messages (the key is per send, not per text)", async () => {
    const h = harness();
    await h.handlers().sendMessage("ok");
    await h.handlers().sendMessage("ok");
    expect(server.rows).toHaveLength(2);
    expect(new Set(server.rows.map((r) => r.client_id)).size).toBe(2);
  });
});
