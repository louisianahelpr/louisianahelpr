/**
 * Q2664 (a): no test account holds a job_match notice (prod read-only SQL 2026-11-04: 406 ever sent, every one to a
 * real Helpr, last 10-27), so an audit could not see how the bell draws one. The admin Messages preview's "Job notices"
 * stage opens the bell's own panel on one notice of each shape prod sends, from the sample alone, and leaves the shared
 * bell store empty behind it: neither a sample notice under the admin's real bells nor a real one in the preview.
 *
 * @mutate src/pages/admin/preview/messagesPreviewSamples.ts |       notifications: stage === "notices" ? jobMatchNotices(me, ago) : [], |       notifications: [],
 * @mutate src/pages/admin/preview/MessagesPreviewPage.tsx |     return () => forgetNotificationFeed(); |     return () => undefined;
 * @mutate src/pages/admin/preview/MessagesPreviewPage.tsx |     forgetNotificationFeed();\n    return |     return
 * @mutate src/components/notificationPanel/notificationFeed.ts |   if (!stillBound(userId) \|\| epoch !== feedEpoch) return;\n  setNotifications(mergeRows( |   if (!stillBound(userId)) return;\n  setNotifications(mergeRows(
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "11111111-1111-4111-8111-111111111111" }, isLoading: false, isAdmin: true, adminStatus: "admin", profile: null, profileQuery: { status: "success", fetchStatus: "idle" }, refresh: async () => undefined }),
}));

import MessagesPreviewPage from "@/pages/admin/preview/MessagesPreviewPage";
import { messagesPreviewSample } from "@/pages/admin/preview/messagesPreviewSamples";
import { supabase } from "@/integrations/supabase/client";
import { getNotificationSnapshot, setNotificationUser, __resetNotificationStore } from "@/components/notificationPanel/notificationStore";
import { forgetNotificationFeed, loadNotificationFeed, __resetNotificationFeedLoad } from "@/components/notificationPanel/notificationFeed";
import type { Notification } from "@/components/notificationPanel/types";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const SUPABASE = String(import.meta.env.VITE_SUPABASE_URL);
const realFetch = globalThis.fetch;
let sent: string[] = [];
const REAL: Notification = {
  id: "99999999-9999-4999-8999-999999999999", user_id: ADMIN_ID, title: "A real notice of the admin's", message: "real", type: "info",
  read: false, link: null, job_id: null, created_at: new Date().toISOString(),
};

beforeEach(() => {
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  sent = [];
  __resetNotificationStore();
  __resetNotificationFeedLoad();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    sent.push(url);
    // Underneath the preview: the admin's real notices.
    const body = url.startsWith(`${SUPABASE}/rest/v1/notifications`) ? JSON.stringify([REAL]) : "[]";
    return new Response(body, { status: 200, headers: { "content-type": "application/json", "content-range": "0-0/1" } });
  }) as typeof fetch;
  vi.spyOn(supabase.auth, "getSession").mockResolvedValue({ data: { session: { user: { id: ADMIN_ID } } }, error: null } as never);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
});

function renderNotices() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/admin/preview/messages?stage=notices&side=helpr"]}>
        <Routes><Route path="/admin/preview/messages" element={<MessagesPreviewPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("admin Messages preview, Job notices (Q2664 a)", () => {
  it("the sample holds one job_match notice of each shape prod sends, on made-up jobs", () => {
    const rows = messagesPreviewSample("notices", "helpr", ADMIN_ID).tables.notifications as Notification[];
    expect(rows.map((r) => r.type)).toEqual(["job_match", "job_match", "job_match"]);
    expect(rows.map((r) => r.title)).toEqual(["New job posted", "🌿 Match for you", "New jobs in Lafayette"]);
    expect(rows[0].link).toMatch(/^\/home\?job=00000000-/);
    expect(rows[1].link).toMatch(/^\/home\?quickApply=00000000-/);
    expect(rows.every((r) => r.user_id === ADMIN_ID && !r.read)).toBe(true);
    // Every other stage's bell holds nothing.
    expect(messagesPreviewSample("inbox", "helpr", ADMIN_ID).tables.notifications).toEqual([]);
  });

  it("opens the bell on the sample's notices, never the admin's real ones, and reads none from the network", async () => {
    // The admin's real bell had just loaded its list (fresh, so an open would reuse it) before the preview opened.
    await loadNotificationFeed(ADMIN_ID);
    expect(getNotificationSnapshot().notifications.map((n) => n.title)).toEqual([REAL.title]);
    sent = [];
    renderNotices();
    expect(await screen.findByText(/Match for you/, undefined, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByText(/was just posted in Lafayette/)).toBeInTheDocument();
    expect(screen.getByText(/New jobs in Lafayette/)).toBeInTheDocument();
    expect(screen.queryByText(REAL.title)).toBeNull();
    expect(sent.filter((u) => u.startsWith(`${SUPABASE}/rest/v1/notifications`))).toEqual([]);
  }, 30000);

  it("leaves no sample notice in the shared bell store once it closes", async () => {
    const r = renderNotices();
    await screen.findByText(/Match for you/, undefined, { timeout: 10000 });
    expect(getNotificationSnapshot().notifications.length).toBe(3);
    r.unmount();
    expect(getNotificationSnapshot().notifications).toEqual([]);
    expect(getNotificationSnapshot().listLoaded).toBe(false);
  }, 30000);

  it("a load that started before the feed was forgotten never writes after it", async () => {
    const waiting: Array<(r: Response) => void> = [];
    globalThis.fetch = (() => new Promise<Response>((res) => { waiting.push(res); })) as typeof fetch;
    const p = loadNotificationFeed(ADMIN_ID).catch(() => undefined);
    forgetNotificationFeed();
    setNotificationUser(ADMIN_ID);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      for (const res of waiting) res(new Response(JSON.stringify([REAL]), { status: 200, headers: { "content-type": "application/json", "content-range": "0-0/1" } }));
      await p;
    });
    expect(getNotificationSnapshot().notifications).toEqual([]);
  });
});
