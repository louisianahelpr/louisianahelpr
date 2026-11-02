// Q1883 (second half): in the "Louisiana Helpr Team" thread, an admin's send that admin_send_team_message refuses
// with one of its own codes is FINAL for that text (not staff, own account, empty, too long, account gone). The
// bubble read "final" from the admin copy text, which lives in a lazily loaded chunk; when that chunk failed to
// load the copy was null and the refusal showed as a retryable "failed" bubble. It is now read from the RPC's own
// codes (ADMIN_SEND_TEAM_MESSAGE_CODES in src/lib/teamThread.ts), which needs no chunk.
//
// Red first: on 783fb7f1fa (`const closed = copy !== null;`) the first test fails: the bubble is "failed".
//
// @mutate src/pages/messages/messagesData/sendHandlers.ts | const closed = copy !== null \|\| (teamUser !== optimistic.sender_id && codeNamedIn(ADMIN_TEAM_SEND_CODES, error) !== null); | const closed = copy !== null;
// @mutate src/lib/teamThread.ts |   "message_too_long",\n | \n

import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";
import type { Conversation, Message } from "@/components/messages/types";
import { ADMIN_RPC_ERROR_COPY } from "@/components/admin/adminRpcErrorCopy";
import { ADMIN_SEND_TEAM_MESSAGE_CODES, teamThreadKey } from "@/lib/teamThread";
import { codesReachableFrom, latestFunctionDefs } from "@/test/helpers/rpcErrorInventory";

const rpcMock = vi.fn();
const loadCopy = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => rpcMock(fn, args),
    from: () => {
      throw new Error("a team send never writes messages directly");
    },
  },
}));
vi.mock("@/lib/lifecycleErrors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/lifecycleErrors")>()),
  // The admin copy chunk, as it resolves when its import fails (null; the loss itself is reported there).
  loadAdminRpcErrorCopy: () => loadCopy(),
}));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn() }));
vi.mock("@/lib/requireOnline", () => ({ requireOnline: () => true }));

import { createSendHandlers } from "./sendHandlers";

const ADMIN = "admin-1";
const MEMBER = "member-1";
const TEAM_CONVO: Conversation = {
  otherUserId: MEMBER,
  otherUserName: "Dana R.",
  jobTitle: "Louisiana Helpr Team",
  jobId: teamThreadKey(MEMBER),
  lastMessage: "",
  lastAt: "2026-11-02T00:00:00.000Z",
  unread: 0,
};

function adminSend(error: { code: string; message: string }) {
  rpcMock.mockImplementation(async () => ({ data: null, error }));
  const setMessages = vi.fn();
  const handlers = createSendHandlers({
    userId: ADMIN,
    cachedUser: { user_metadata: { full_name: "Admin" } },
    activeConvo: TEAM_CONVO,
    messages: [] as Message[],
    warningShown: false,
    setWarningShown: vi.fn(),
    setMessages,
    setConversations: vi.fn(),
    scrollToBottom: vi.fn(),
    activeConvoRef: { current: TEAM_CONVO },
    loadConversations: vi.fn(async () => {}),
  });
  return { handlers, setMessages };
}

function finalBubble(setMessages: ReturnType<typeof vi.fn>): Message | undefined {
  const msgs = setMessages.mock.calls.reduce<Message[]>((acc, [arg]) => (typeof arg === "function" ? arg(acc) : arg), []);
  return msgs[msgs.length - 1];
}

beforeEach(() => {
  rpcMock.mockReset();
  loadCopy.mockReset();
});

describe("team thread: an admin send refused by admin_send_team_message stays final without the admin copy chunk (Q1883)", () => {
  it("every one of the RPC's codes leaves a refused bubble (no retry) when the chunk failed to load", async () => {
    loadCopy.mockResolvedValue(null);
    for (const code of ADMIN_SEND_TEAM_MESSAGE_CODES) {
      const { handlers, setMessages } = adminSend({ code: "22023", message: code });
      await handlers.sendMessage("hello from the team");
      expect(rpcMock).toHaveBeenCalledWith("admin_send_team_message", expect.objectContaining({ p_user_id: MEMBER }));
      expect(finalBubble(setMessages)?.sendStatus, code).toBe("refused");
    }
  });

  it("a network-style failure with no RPC code still offers the retry", async () => {
    loadCopy.mockResolvedValue(null);
    const { handlers, setMessages } = adminSend({ code: "", message: "TypeError: Failed to fetch" });
    await handlers.sendMessage("hello from the team");
    expect(finalBubble(setMessages)?.sendStatus).toBe("failed");
  });

  it("the list is exactly the RPC's codes and the admin copy table's keys", () => {
    expect(ADMIN_SEND_TEAM_MESSAGE_CODES.length).toBeGreaterThan(3);
    expect([...ADMIN_SEND_TEAM_MESSAGE_CODES].sort()).toEqual(Object.keys(ADMIN_RPC_ERROR_COPY.admin_send_team_message).sort());
    const defs = latestFunctionDefs(join(process.cwd(), "supabase/migrations"));
    expect(defs.has("admin_send_team_message")).toBe(true);
    const raised = [...codesReachableFrom("admin_send_team_message", defs).keys()].sort();
    expect(raised).toEqual([...ADMIN_SEND_TEAM_MESSAGE_CODES].sort());
  });
});
