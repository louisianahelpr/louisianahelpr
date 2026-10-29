/**
 * AN OPEN CHAT'S URL NAMES ITS THREAD, AND RESUMING THAT URL REOPENS THAT EXACT THREAD.
 *
 * Audit 2026-10-28 (part 4 half 2, F27): an open chat's URL was `/messages?chat=1`. The flag said "a
 * thread is open" but not WHICH, so route memory dropped it (lastRoute TRANSIENT_PARAMS) and a resume,
 * a reload or a shared link landed on the inbox, not the conversation.
 *
 * Lead decision 2026-10-28: the URL is `/messages?chat=<jobId>&with=<userId>`. A link with only a job id
 * opens the chat when that job has exactly one other party, otherwise the list. Legacy `?chat=1` names
 * no thread and is still stripped (the no-bottom-nav trap, lastRoute.test.ts).
 *
 * @mutate src/pages/messages/constants.ts |   if (c.otherUserId && !isTeamThreadKey(c.jobId)) q.set("with", c.otherUserId); |   void q;
 * @mutate src/lib/lastRoute.ts |   if (chat !== null && !namesAThread(chat)) { |   if (chat !== null) {
 * @mutate src/pages/messages/constants.ts |   const jobId = chat && chat !== LEGACY_CHAT_FLAG ? chat : null; |   const jobId = null as string \| null;
 * @mutate src/pages/messages/useMessagesData.ts |     navigate(chatOpenPath(convo), { |     navigate("/messages?chat=1", {
 * @mutate src/pages/messages/Messages.tsx |   const deepLinkJobId = searchParams.get("jobId") ?? resumedThread?.jobId ?? null; |   const deepLinkJobId = searchParams.get("jobId");
 * @mutate src/pages/messages/Messages.tsx |     if (!activeConvo && flagged && !resumePending) { |     if (!activeConvo && flagged) {
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NavigateFunction } from "react-router-dom";
import type { Conversation } from "@/components/messages/types";

const fetchConversationsMock = vi.fn();
vi.mock("@/pages/messages/messagesData/loadConversations", () => ({
  fetchConversations: (...args: unknown[]) => fetchConversationsMock(...args),
  buildDeepLinkPlaceholder: vi.fn(async () => ({ problem: "no placeholder in this test" })),
  buildTeamThreadPlaceholder: vi.fn(async () => ({ problem: "no placeholder in this test" })),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or", "order", "limit", "lt", "lte", "like", "in", "update", "is"]) c[m] = () => c;
    c.maybeSingle = () => Promise.resolve(result);
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
    return c;
  };
  return {
    supabase: {
      from: () => chain({ data: [], error: null }),
      rpc: () => Promise.resolve({ data: [], error: null }),
      auth: { refreshSession: () => Promise.resolve({ data: {}, error: null }) },
    },
  };
});

import { useMessagesData } from "@/pages/messages/useMessagesData";
import { chatOpenPath, threadFromChatFlag } from "@/pages/messages/constants";
import { rememberRoute, readRestorableRoute } from "@/lib/lastRoute";

const USER = "user-1";
const convo = (jobId: string, otherUserId: string | null, name = "Dana R."): Conversation => ({
  otherUserId, otherUserName: name, jobTitle: "Clean the kitchen", jobId,
  lastMessage: "hi", lastAt: "2026-10-28T10:00:00.000Z", unread: 0,
});
// A crew job with two other parties, and a one-to-one job.
const CREW_A = convo("job-crew", "helpr-a", "Hallie H.");
const CREW_B = convo("job-crew", "helpr-b", "Bo B.");
const SOLO = convo("job-solo", "helpr-c", "Cy C.");
const INBOX = [CREW_A, CREW_B, SOLO];

/** What Messages hands useMessagesData when it mounts on `url` (the resume). */
function resume(url: string) {
  const navigate = vi.fn() as unknown as NavigateFunction & ReturnType<typeof vi.fn>;
  const flag = threadFromChatFlag(new URL(url, "https://x.test").searchParams);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const hook = renderHook(
    () => useMessagesData({
      userId: null, cachedUser: { id: USER },
      deepLinkJobId: flag?.jobId ?? null, deepLinkUserId: flag?.userId ?? null,
      deepLinkTeamUserId: flag?.teamUserId ?? null,
      navigate, scrollToBottom: vi.fn(), activeConvoRef: { current: null }, chatContainerRef: { current: null },
    }),
    { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> },
  );
  return { ...hook, navigate };
}

beforeEach(() => {
  fetchConversationsMock.mockReset();
  fetchConversationsMock.mockResolvedValue(INBOX);
  localStorage.clear();
});

describe("an open chat's URL names its thread (F27)", () => {
  it("is /messages?chat=<jobId>&with=<userId>, or the job alone for a deleted account", () => {
    expect(chatOpenPath(CREW_B)).toBe("/messages?chat=job-crew&with=helpr-b");
    expect(chatOpenPath(convo("job-x", null))).toBe("/messages?chat=job-x");
  });

  it("route memory keeps it, so a resume comes back to it (legacy ?chat=1 is still dropped)", () => {
    for (const c of INBOX) {
      rememberRoute(chatOpenPath(c));
      expect(readRestorableRoute()).toBe(chatOpenPath(c));
    }
    rememberRoute("/messages?chat=1");
    expect(readRestorableRoute()).toBe("/messages");
    expect(threadFromChatFlag(new URLSearchParams("chat=1"))).toBeNull();
  });

  it("opening a thread puts that exact thread in the URL", async () => {
    const { result, navigate } = resume("/messages");
    await waitFor(() => expect(result.current.loading).toBe(false));
    await result.current.openConvo(CREW_B);
    expect(navigate).toHaveBeenCalledWith("/messages?chat=job-crew&with=helpr-b", expect.anything());
  });
});

describe("resuming reopens that exact thread (F27)", () => {
  it("on a crew job, reopens the thread with the named person, not the other one", async () => {
    // Inventory floor: the crew job really has more than one thread to pick from.
    expect(INBOX.filter((c) => c.jobId === "job-crew").length).toBeGreaterThan(1);
    for (const target of [CREW_A, CREW_B, SOLO]) {
      const { result, unmount } = resume(chatOpenPath(target));
      await waitFor(() => expect(result.current.activeConvo).toEqual(target));
      unmount();
    }
  });

  it("a job id alone opens the chat when there is exactly one other party", async () => {
    const { result } = resume("/messages?chat=job-solo");
    await waitFor(() => expect(result.current.activeConvo).toEqual(SOLO));
  });

  it("a job id alone with two other parties opens the list, and says it is settled", async () => {
    const { result } = resume("/messages?chat=job-crew");
    await waitFor(() => expect(result.current.deepLinkSettled).toBe(true));
    expect(result.current.activeConvo).toBeNull();
  });
});

// Messages is the page that mounts on the resumed URL. Rendering it whole needs the realtime, presence
// and auth layers, so its two moves are read from its code (comments blanked): it hands the thread the
// URL names to the loader above, and it keeps that flag until the loader has settled.
describe("Messages hands a resumed thread to the loader and waits for it (F27)", () => {
  const src = blankComments(readFileSync("src/pages/messages/Messages.tsx", "utf8"));
  it("reads the thread the mounted URL names, once", () => {
    expect(src).toContain("useState(() => threadFromChatFlag(searchParams))");
    expect(src).toMatch(/deepLinkJobId = searchParams\.get\("jobId"\) \?\? resumedThread\?\.jobId/);
    expect(src).toMatch(/deepLinkUserId = searchParams\.get\("userId"\) \?\? resumedThread\?\.userId/);
    expect(src).toMatch(/deepLinkTeamUserId = searchParams\.get\("teamThread"\) \?\? resumedThread\?\.teamUserId/);
  });
  it("does not strip a flag that names a thread until the loader settles", () => {
    expect(src).toContain("const resumePending = !!resumedThread && !deepLinkSettled && !loadError;");
    expect(src).toContain("if (!activeConvo && flagged && !resumePending) {");
  });
});
