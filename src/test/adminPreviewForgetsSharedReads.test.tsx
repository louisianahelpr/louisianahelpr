/**
 * NOTHING A PREVIEW ANSWERED CARRIES INTO THE REAL APP, AND NOTHING REAL IS DRAWN IN A PREVIEW (b177 handoff, lead 11-02).
 *
 * Two app modules share a read outside React Query: userBlocks keeps its block read for 2 s (and joins one in flight),
 * activityCores joins its in-flight read. The Messages preview is drawn for the admin's REAL id, so a block read it
 * answered from its sample (Eli blocked) would be handed to the real Messages page opened within 2 s, and a real read
 * held when the preview opened would be drawn inside it. Each preview backend now drops both when it goes in and when
 * it comes out (previewParts.ts forgetSharedReads). Checked on the real modules: a read held before the preview is not
 * the one the preview gets, and a read made inside the preview is not the one the app gets after it closes.
 *
 * @mutate src/pages/admin/preview/MessagesPreviewPage.tsx |       undoRealtime();\n      forgetSharedReads(); |       undoRealtime();
 * @mutate src/pages/admin/preview/MessagesPreviewPage.tsx |     const undoRealtime = installInertRealtime();\n    forgetSharedReads(); |     const undoRealtime = installInertRealtime();
 * @mutate src/pages/admin/preview/JobPreviewPage.tsx |       undoRealtime();\n      forgetSharedReads(); |       undoRealtime();
 * @mutate src/pages/admin/preview/previewParts.tsx |   forgetAllBlockReads();\n  forgetActivityCoresRead(); |   forgetAllBlockReads();
 * @mutate src/pages/admin/preview/previewParts.tsx |   forgetAllBlockReads();\n  forgetActivityCoresRead(); |   forgetActivityCoresRead();
 * @mutate src/pages/admin/preview/MessagesPreviewPage.tsx |   useLayoutEffect(() => {\n    forgetSharedReads();\n  }, [sample]); |   useLayoutEffect(() => {\n  }, [sample]);
 * @mutate src/pages/admin/preview/MessagesPreviewPage.tsx | onLeave={() => navigate("/admin?view=reports")} | onLeave={() => navigate("/admin?tab=settings")}
 * @mutate src/lib/userBlocks.ts | export function forgetAllBlockReads(): void {\n  blockReads.clear(); | export function forgetAllBlockReads(): void {\n  void blockReads;
 * @mutate src/lib/activityCores.ts | export function forgetActivityCoresRead(): void {\n  inFlight = null; | export function forgetActivityCoresRead(): void {\n  void inFlight;
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
vi.mock("sonner", async (orig) => {
  const real = await orig<typeof import("sonner")>();
  return { ...real, toast: Object.assign(() => "", real.toast, { error: () => "", success: () => "", warning: () => "" }) };
});
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "11111111-1111-4111-8111-111111111111" }, isLoading: false, isAdmin: true, adminStatus: "admin", profile: null, profileQuery: { status: "success", fetchStatus: "idle" }, refresh: async () => undefined }),
}));

import MessagesPreviewPage from "@/pages/admin/preview/MessagesPreviewPage";
import JobPreviewPage from "@/pages/admin/preview/JobPreviewPage";
import { readUserBlockRows, __resetBlockReadsForTests } from "@/lib/userBlocks";
import { fetchActivityCores, forgetActivityCoresRead } from "@/lib/activityCores";

const realFetch = globalThis.fetch;
/** The network under the preview: a real block row nobody in a sample has, and an activity read that never answers. */
beforeEach(() => {
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  __resetBlockReadsForTests();
  forgetActivityCoresRead();
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("/rpc/get_my_activity_cores")) return new Promise<Response>(() => undefined);
    const body = url.includes("/rest/v1/user_blocks") ? [{ blocker_id: ADMIN_ID, blocked_id: "real-0000" }] : [];
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

let where = "";
function Where() {
  const l = useLocation();
  where = `${l.pathname}${l.search}`;
  return null;
}

function renderAt(url: string, el: JSX.Element, route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Where />
        <Routes><Route path={route} element={el} /><Route path="/admin" element={<p>ADMIN</p>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const openMessages = () => renderAt("/admin/preview/messages?stage=blocked&side=poster", <MessagesPreviewPage />, "/admin/preview/messages");
const openJob = () => renderAt("/admin/preview/job?stage=hired&viewer=poster", <JobPreviewPage />, "/admin/preview/job");
const drawn = () => waitFor(() => expect(document.querySelector("[data-preview-controls]")).not.toBeNull(), { timeout: 10000 });
const blockedIds = async (p: ReturnType<typeof readUserBlockRows>) => ((await p).data ?? []).map((r) => r.blocked_id);

describe("the admin previews drop the app's shared reads when they open and close", () => {
  it("Messages preview: a real block read held before it opens is not the one drawn inside it", async () => {
    const real = readUserBlockRows(ADMIN_ID);
    expect(await blockedIds(real)).toEqual(["real-0000"]);
    openMessages();
    await drawn();
    const inside = readUserBlockRows(ADMIN_ID);
    expect(inside).not.toBe(real);
    expect(await blockedIds(inside)).not.toContain("real-0000");
  }, 30000);

  it("Messages preview: a block read it answered from its sample is not handed to the app after it closes", async () => {
    const view = openMessages();
    await drawn();
    const inside = readUserBlockRows(ADMIN_ID);
    await inside;
    view.unmount();
    const after = readUserBlockRows(ADMIN_ID);
    expect(after).not.toBe(inside);
    expect(await blockedIds(after)).toEqual(["real-0000"]);
  }, 30000);

  it("Messages preview: an activity read in flight is never joined across the boundary, either way", async () => {
    const real = fetchActivityCores(ADMIN_ID);
    const view = openMessages();
    await drawn();
    const inside = fetchActivityCores(ADMIN_ID);
    expect(inside).not.toBe(real);
    view.unmount();
    expect(fetchActivityCores(ADMIN_ID)).not.toBe(inside);
  }, 30000);

  it("Job preview: the same on close (a read made while it was open is not reused after)", async () => {
    const view = openJob();
    await drawn();
    const inside = readUserBlockRows(ADMIN_ID);
    await inside;
    const coresInside = fetchActivityCores(ADMIN_ID);
    view.unmount();
    expect(readUserBlockRows(ADMIN_ID)).not.toBe(inside);
    expect(fetchActivityCores(ADMIN_ID)).not.toBe(coresInside);
  }, 30000);

  // Audit 1102e: "After a block" opened from another stage kept Eli in the inbox: the inbox stage's block read (no
  // blocks) was still held (2 s) and reused. A new stage drops it, so the blocked stage reads its own sample's block.
  it("Messages preview: switching to After a block reads that stage's block, not the last stage's", async () => {
    const view = renderAt("/admin/preview/messages?stage=inbox&side=poster", <MessagesPreviewPage />, "/admin/preview/messages");
    await drawn();
    const inboxRead = readUserBlockRows(ADMIN_ID);
    expect(await blockedIds(inboxRead)).toEqual([]);
    fireEvent.click(screen.getByRole("radio", { name: "After a block" }));
    await waitFor(() => expect(document.querySelector('[data-preview-view="blocked:poster"]')).not.toBeNull());
    const blockedRead = readUserBlockRows(ADMIN_ID);
    expect(blockedRead).not.toBe(inboxRead);
    expect((await blockedIds(blockedRead)).length).toBe(1);
    view.unmount();
  }, 30000);

  it("Messages preview: Leave goes back to Admin > Reports, where it is opened from", async () => {
    openMessages();
    await drawn();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(where).toBe("/admin?view=reports"));
  }, 30000);
});
