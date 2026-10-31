// A thread the server will no longer let this viewer send in must say so,
// never offer a composer whose sends silently bounce.
//
// Owner decisions 2026-09-14 (migrations 20260914210443 + 20260914215014):
// only the poster may message applicants and the offered (not yet accepted)
// Helpr; a messaged applicant or an offered Helpr reaches only the poster. A
// non-poster who ALREADY had a thread with an applicant, or now with an offered
// Helpr, therefore opens a thread whose every send RLS refuses with 42501 and
// no reason. These tests pin the client half: the server's own receiver gate
// (can_send_message_to_in_job) decides, the open thread shows a read-only
// notice, a refused send is non-retryable, and a refusal with ANOTHER cause
// (banned, replaced, rate cap, the poster itself) is never blamed on the rule.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { Conversation, Message } from "@/components/messages/types";

const rpcMock = vi.fn();
const fromMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => rpcMock(fn, args),
    from: (table: string) => fromMock(table),
  },
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), warning: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn() }));

import {
  RECIPIENT_NOT_ON_JOB_NOTICE,
  RECIPIENT_NOT_ON_JOB_TOAST,
  RECIPIENT_RESTRICTED_NOTICE,
  RECIPIENT_RESTRICTED_TOAST,
  fetchRecipientRestricted,
  useRecipientRestricted,
} from "./recipientGate";
import { ChatComposer } from "@/components/messages/chatView/ChatComposer";
import { createSendHandlers } from "@/pages/messages/messagesData/sendHandlers";

const ME = "11111111-1111-4111-8111-111111111111";
const POSTER = "22222222-2222-4222-8222-222222222222";
const APPLICANT = "33333333-3333-4333-8333-333333333333";
const JOB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

type Answer = boolean | { error: { code: string; message?: string } };
/** rpc router: the gate's answer per receiver, and no lockout clock. */
function routeGate(byReceiver: Record<string, Answer>) {
  rpcMock.mockImplementation((fn: string, args: { _receiver?: string }) => {
    if (fn === "can_send_message_to_in_job") {
      const a = byReceiver[args._receiver ?? ""];
      if (a === undefined) return Promise.resolve({ data: false, error: null });
      return Promise.resolve(typeof a === "boolean" ? { data: a, error: null } : { data: null, error: a.error });
    }
    if (fn === "get_messaging_closes_at") return Promise.resolve({ data: [], error: null });
    return Promise.resolve({ data: null, error: { code: "PGRST202" } });
  });
}
const gateCalls = () => rpcMock.mock.calls.filter(([fn]) => fn === "can_send_message_to_in_job");

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
  toastError.mockReset();
});

describe("fetchRecipientRestricted (server-derived)", () => {
  it("restricted: the gate refuses this receiver but still admits the poster", async () => {
    routeGate({ [APPLICANT]: false, [POSTER]: true });
    expect(await fetchRecipientRestricted(JOB, APPLICANT, ME, POSTER)).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("can_send_message_to_in_job", { _job_id: JOB, _receiver: APPLICANT });
    expect(rpcMock).toHaveBeenCalledWith("can_send_message_to_in_job", { _job_id: JOB, _receiver: POSTER });
  });
  it("not restricted when the gate allows the send (no control call)", async () => {
    routeGate({ [APPLICANT]: true, [POSTER]: true });
    expect(await fetchRecipientRestricted(JOB, APPLICANT, ME, POSTER)).toBe(false);
    expect(gateCalls()).toHaveLength(1);
  });
  it("not blamed on the rule when the caller cannot reach the poster either (banned, replaced, rate cap, closed)", async () => {
    routeGate({ [APPLICANT]: false, [POSTER]: false });
    expect(await fetchRecipientRestricted(JOB, APPLICANT, ME, POSTER)).toBe(false);
  });
  it("never for the poster as receiver, or an ownerless job", async () => {
    routeGate({ [APPLICANT]: false, [POSTER]: true });
    expect(await fetchRecipientRestricted(JOB, POSTER, ME, POSTER)).toBe(false);
    expect(await fetchRecipientRestricted(JOB, APPLICANT, ME, null)).toBe(false);
    expect(gateCalls()).toHaveLength(0);
  });
  // A3-B3 (app audit 2026-10-29): the poster's thread with someone who is no
  // longer anyone on the job (no application, offer, hire or crew place) is
  // refused by the same gate; it must close up front, never offer a retry.
  it("the POSTER is restricted when the gate refuses the person in the thread", async () => {
    routeGate({ [APPLICANT]: false, [POSTER]: true });
    expect(await fetchRecipientRestricted(JOB, APPLICANT, POSTER, POSTER)).toBe(true);
  });
  it("the poster is not restricted when the gate refuses the poster too (rate cap, banned, closed)", async () => {
    routeGate({ [APPLICANT]: false, [POSTER]: false });
    expect(await fetchRecipientRestricted(JOB, APPLICANT, POSTER, POSTER)).toBe(false);
  });
  it("fails open (no notice) on an RPC error or a missing RPC", async () => {
    routeGate({ [APPLICANT]: { error: { code: "PGRST202" } }, [POSTER]: true });
    expect(await fetchRecipientRestricted(JOB, APPLICANT, ME, POSTER)).toBe(false);
    routeGate({ [APPLICANT]: false, [POSTER]: { error: { code: "500", message: "boom" } } });
    expect(await fetchRecipientRestricted(JOB, APPLICANT, ME, POSTER)).toBe(false);
  });
});

describe("useRecipientRestricted (open thread)", () => {
  const convo = (over: Partial<Conversation> = {}) =>
    ({ jobId: JOB, otherUserId: APPLICANT, viewerIsPoster: false, posterId: POSTER, ...over }) as Conversation;

  it("a non-poster's thread with an applicant is restricted", async () => {
    routeGate({ [APPLICANT]: false, [POSTER]: true });
    const { result } = renderHook(() => useRecipientRestricted({ activeConvo: convo(), userId: ME, skip: false }));
    await waitFor(() => expect(result.current).toBe(true));
  });
  it("closes the POSTER's thread up front when the person is no longer on the job (A3-B3)", async () => {
    routeGate({ [APPLICANT]: false, [POSTER]: true });
    const { result } = renderHook(() =>
      useRecipientRestricted({ activeConvo: convo({ viewerIsPoster: true }), userId: POSTER, skip: false }),
    );
    await waitFor(() => expect(result.current).toBe(true));
  });
  it("leaves the poster's thread open while the person is still on the job", async () => {
    routeGate({ [APPLICANT]: true, [POSTER]: true });
    const { result } = renderHook(() =>
      useRecipientRestricted({ activeConvo: convo({ viewerIsPoster: true }), userId: POSTER, skip: false }),
    );
    await waitFor(() => expect(gateCalls().length).toBeGreaterThan(0));
    expect(result.current).toBe(false);
  });
  it("does not ask while another notice already owns the dock", async () => {
    routeGate({ [APPLICANT]: false, [POSTER]: true });
    const { result } = renderHook(() => useRecipientRestricted({ activeConvo: convo(), userId: ME, skip: true }));
    await act(async () => {});
    expect(result.current).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
  it("honours a refusal already recorded on the open conversation", async () => {
    routeGate({ [APPLICANT]: true, [POSTER]: true });
    const { result } = renderHook(() =>
      useRecipientRestricted({ activeConvo: convo({ recipientRestricted: true }), userId: ME, skip: false }),
    );
    expect(result.current).toBe(true);
  });
});

describe("ChatComposer recipient-restricted notice", () => {
  const base = {
    composerLocked: false,
    chatLoadError: false,
    keyboardInset: 0,
    activeConvo: { jobId: JOB, otherUserId: APPLICANT } as unknown as Conversation,
    messages: [],
    userId: ME,
    draft: "",
    setDraft: () => {},
    sendMessage: async () => true,
    broadcastTyping: () => {},
  };
  it("replaces the composer with a read-only notice", () => {
    render(<ChatComposer {...base} recipientRestricted />);
    expect(screen.getByTestId("thread-recipient-restricted-notice")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(RECIPIENT_RESTRICTED_NOTICE);
    expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("tells the poster, in one line, that the person isn't on the job", () => {
    render(
      <ChatComposer
        {...base}
        activeConvo={{ jobId: JOB, otherUserId: APPLICANT, viewerIsPoster: true } as unknown as Conversation}
        recipientRestricted
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(RECIPIENT_NOT_ON_JOB_NOTICE);
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("a send refused by the receiver gate", () => {
  function setup(sender = ME, over: Partial<Conversation> = {}) {
    let messages: Message[] = [];
    let active: Conversation | null = {
      jobId: JOB, otherUserId: APPLICANT, viewerIsPoster: sender === POSTER, posterId: POSTER, ...over,
    } as Conversation;
    let convos: Conversation[] = [active];
    const apply = <T,>(prev: T, v: T | ((p: T) => T)) => (typeof v === "function" ? (v as (p: T) => T)(prev) : v);
    const handlers = createSendHandlers({
      userId: sender,
      cachedUser: null,
      activeConvo: active,
      messages,
      warningShown: false,
      setWarningShown: () => {},
      setMessages: (v) => { messages = apply(messages, v); },
      setConversations: (v) => { convos = apply(convos, v); },
      scrollToBottom: () => {},
      activeConvoRef: { current: active },
      loadConversations: async () => {},
      setActiveConvo: (v) => { active = apply(active, v); },
    });
    const optimistic = {
      id: "optimistic-c1", clientId: "c1", sendStatus: "sending", job_id: JOB, sender_id: sender,
      receiver_id: APPLICANT, content: "hi", read: false, created_at: new Date().toISOString(),
    } as Message;
    messages = [optimistic];
    return { handlers, optimistic, get: () => ({ messages, active, convos }) };
  }
  const rlsRefusal = { code: "42501", message: 'new row violates row-level security policy for table "messages"' };
  function insertRefused(error: { code: string; message: string } = rlsRefusal) {
    const insertChain = { select: () => insertChain, single: () => Promise.resolve({ data: null, error }) };
    return { insert: () => insertChain };
  }

  it("is non-retryable, flips the open thread to the notice and says why", async () => {
    routeGate({ [APPLICANT]: false, [POSTER]: true });
    fromMock.mockImplementation(() => insertRefused());
    const s = setup();
    await s.handlers.dispatchMessage(s.optimistic);
    expect(s.get().messages[0].sendStatus).toBe("refused");
    expect(s.get().active?.recipientRestricted).toBe(true);
    expect(toastError).toHaveBeenCalledWith(RECIPIENT_RESTRICTED_TOAST);
  });
  it("stays retryable when the gate says the receiver is reachable", async () => {
    routeGate({ [APPLICANT]: true, [POSTER]: true });
    fromMock.mockImplementation(() => insertRefused());
    const s = setup();
    await s.handlers.dispatchMessage(s.optimistic);
    expect(s.get().messages[0].sendStatus).toBe("failed");
    expect(s.get().active?.recipientRestricted).toBeFalsy();
  });
  it("stays retryable when the caller cannot reach the poster either (rate cap, banned, replaced)", async () => {
    routeGate({ [APPLICANT]: false, [POSTER]: false });
    fromMock.mockImplementation(() => insertRefused());
    const s = setup();
    await s.handlers.dispatchMessage(s.optimistic);
    expect(s.get().messages[0].sendStatus).toBe("failed");
    expect(toastError).not.toHaveBeenCalledWith(RECIPIENT_RESTRICTED_TOAST);
  });
  it("a POSTER refused by the gate gets no retry and is told why, not 'only the poster can' (A3-B3)", async () => {
    routeGate({ [APPLICANT]: false, [POSTER]: true });
    fromMock.mockImplementation(() => insertRefused());
    const s = setup(POSTER);
    await s.handlers.dispatchMessage(s.optimistic);
    expect(s.get().messages[0].sendStatus).toBe("refused");
    expect(s.get().active?.recipientRestricted).toBe(true);
    expect(toastError).toHaveBeenCalledWith(RECIPIENT_NOT_ON_JOB_TOAST);
    expect(toastError).not.toHaveBeenCalledWith(RECIPIENT_RESTRICTED_TOAST);
  });
  it("a poster at the hourly cap keeps the retry (the gate refuses the poster too)", async () => {
    routeGate({ [APPLICANT]: false, [POSTER]: false });
    fromMock.mockImplementation(() => insertRefused());
    const s = setup(POSTER);
    await s.handlers.dispatchMessage(s.optimistic);
    expect(s.get().messages[0].sendStatus).toBe("failed");
    expect(s.get().active?.recipientRestricted).toBeFalsy();
  });
  it("a block trigger's 42501 is not blamed on the recipient rule", async () => {
    routeGate({ [APPLICANT]: false, [POSTER]: true });
    fromMock.mockImplementation(() => insertRefused({ code: "42501", message: "You can't message this user." }));
    const s = setup();
    await s.handlers.dispatchMessage(s.optimistic);
    // Q998: the block is named and final (a retry can never work), and it is
    // still not blamed on the receiver rule.
    expect(s.get().messages[0].sendStatus).toBe("refused");
    expect(s.get().messages[0].failReason).toBe("blocked");
    // AUD31-42: the refused bubble's label says why, so no toast covers it (and none blames the recipient rule).
    expect(toastError).not.toHaveBeenCalled();
    expect(s.get().active?.recipientRestricted).toBeFalsy();
    expect(gateCalls()).toHaveLength(0);
  });
});

// The CONTROL call is what separates "the receiver rule refused you" from
// every other refusal (banned, replaced, thread closed, 30/hour cap). Without
// it a rate-limited or banned sender is told "only the poster can message
// them", and their retryable send is made permanently non-retryable.
// @mutate src/lib/recipientGate.ts | return (await askGate(jobId, posterId)) === true; | return true;
// A3-B3: restore the poster exemption, which left the poster's thread with a
// live composer whose every send bounced and offered "tap to retry".
// @mutate src/lib/recipientGate.ts | if (receiverId === posterId) return false; | if (userId === posterId \|\| receiverId === posterId) return false;
