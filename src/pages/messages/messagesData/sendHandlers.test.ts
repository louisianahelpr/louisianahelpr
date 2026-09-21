// docs/OPEN.md queue #1, residual (2026-09-15): sendMessage's client-side
// scan showed "This is your first warning" the instant the CLIENT regex
// fired — before the server ever got a say. The client scanner deliberately
// flags a few phrases ("my number", "my email", F-TRUST-01) that the
// server's contact_leak_reason() does not act on, so a poster typing "call
// me on my number, I don't check Helpr messages" was told about a strike
// that apply_message_violation_consequence's own response (`not_flagged`)
// proves was never recorded.
//
// Fix: the immediate, synchronous toast is neutral ("remove contact
// details…") for EVERY client-side match. Strike/warning wording now comes
// only from logViolation's RPC response — the server's actual verdict —
// and only for the rungs it really ran (`warning` / `final_warning` /
// `pending_ban_review`).
//
// Red first: run against the pre-fix sendHandlers.ts (the synchronous toast
// always read "⚠️ Warning: … This is your first warning…") and this file's
// first test fails because that toast is not neutral.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Conversation, Message } from "@/components/messages/types";

const rpcMock = vi.fn();
const insertResult = { data: null as unknown, error: null as unknown };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => rpcMock(fn, args),
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["insert", "select"]) chain[m] = () => chain;
      chain.single = () => Promise.resolve(insertResult);
      return chain;
    },
  },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn() }));
vi.mock("@/lib/requireOnline", () => ({ requireOnline: () => true }));
vi.mock("@/lib/messagingLockout", () => ({
  THREAD_CLOSED_TOAST: "thread closed",
  fetchMessagingClosesAt: async () => new Map(),
  isLockoutRefusal: () => false,
}));
vi.mock("@/lib/recipientGate", () => ({
  RECIPIENT_RESTRICTED_TOAST: "recipient restricted",
  fetchRecipientRestricted: async () => false,
}));

import { toast } from "sonner";
import { createSendHandlers } from "./sendHandlers";

const ACTIVE_CONVO: Conversation = {
  otherUserId: "other-1",
  otherUserName: "Dana R.",
  jobTitle: "Fix the fence",
  jobId: "job-1",
  lastMessage: "",
  lastAt: "2026-09-15T00:00:00.000Z",
  unread: 0,
};

function makeHandlers(overrides: { userId: string }) {
  return createSendHandlers({
    userId: overrides.userId,
    cachedUser: { user_metadata: { full_name: "Test User" } },
    activeConvo: ACTIVE_CONVO,
    messages: [] as Message[],
    warningShown: false,
    setWarningShown: vi.fn(),
    setMessages: vi.fn(),
    setConversations: vi.fn(),
    scrollToBottom: vi.fn(),
    activeConvoRef: { current: ACTIVE_CONVO },
    loadConversations: vi.fn(async () => {}),
  });
}

const toastError = () => (toast.error as ReturnType<typeof vi.fn>);

beforeEach(() => {
  rpcMock.mockReset();
  toastError().mockClear();
});

describe("sendMessage — client-flagged content, honest strike wording", () => {
  it("shows a neutral notice (never strike wording) for a phrase only the CLIENT flags, and never adds a strike toast once the server says not_flagged", async () => {
    rpcMock.mockResolvedValue({ data: { action: "not_flagged" }, error: null });
    const { sendMessage } = makeHandlers({ userId: "user-client-only" });

    const sent = await sendMessage("here is my number, use it");

    expect(sent).toBe(false);
    // The RPC (apply_message_violation_consequence) really was asked, and
    // really answered "not_flagged" — the server never recorded anything.
    // ("my number" is deliberately CLIENT-ONLY — F-TRUST-01, messageScanner.ts
    // — the server's contact_leak_reason has no such phrase.)
    expect(rpcMock).toHaveBeenCalledWith(
      "apply_message_violation_consequence",
      expect.objectContaining({ p_content: "here is my number, use it" }),
    );

    const calls = toastError().mock.calls.map((c) => String(c[0]));
    // Exactly one toast: the neutral notice. No "warning"/"first warning"/
    // "blocked" strike wording anywhere in what the user was shown.
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toMatch(/warning/i);
    expect(calls[0]).not.toMatch(/blocked/i);
    expect(calls[0].toLowerCase()).toContain("remove contact details");
  });

  it("shows the neutral notice first, then the real first-warning toast only once the server confirms a violation was recorded", async () => {
    rpcMock.mockResolvedValue({ data: { action: "warning" }, error: null });
    const { sendMessage } = makeHandlers({ userId: "user-real-phone" });

    const sent = await sendMessage("call me at 225-555-0199");

    expect(sent).toBe(false);
    expect(rpcMock).toHaveBeenCalledWith(
      "apply_message_violation_consequence",
      expect.objectContaining({ p_content: "call me at 225-555-0199" }),
    );

    const calls = toastError().mock.calls.map((c) => String(c[0]));
    expect(calls).toHaveLength(2);
    // First (synchronous, before the RPC could possibly have answered):
    // the neutral notice.
    expect(calls[0].toLowerCase()).toContain("remove contact details");
    // Second (only after the RPC's own verdict came back "warning"): the
    // real strike wording.
    expect(calls[1]).toMatch(/this is your first warning/i);
  });

  it("never claims a strike for a final_warning or pending_ban_review verdict either — the neutral notice plus the RPC's own copy, nothing invented", async () => {
    rpcMock.mockResolvedValue({ data: { action: "pending_ban_review" }, error: null });
    const { sendMessage } = makeHandlers({ userId: "user-repeat-offender" });

    await sendMessage("text me at 225-555-0199 again");

    const calls = toastError().mock.calls.map((c) => String(c[0]));
    expect(calls).toHaveLength(2);
    expect(calls[0].toLowerCase()).toContain("remove contact details");
    expect(calls[1]).toMatch(/restricted for 7 days/i);
    // Never the first-offence wording once it's actually the third strike.
    expect(calls[1]).not.toMatch(/first warning/i);
  });
});

// The rung that records the strike. Without this call the message is still
// blocked on this device, but apply_message_violation_consequence is never
// asked, so nothing is recorded and no verdict copy is ever shown.
// @mutate src/pages/messages/messagesData/sendHandlers.ts | await logViolation(userId, cachedUser, violationDesc, content); | void 0;
