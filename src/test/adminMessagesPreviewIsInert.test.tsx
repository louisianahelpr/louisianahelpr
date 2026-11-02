/**
 * THE ADMIN MESSAGES PREVIEW NEVER TOUCHES A REAL MESSAGE (lead 11-02, audit 1102d: no test account has a conversation,
 * so Messages thread / blocked / reported could not be walked).
 *
 * /admin/preview/messages draws the real Messages page (pages/messages/Messages.tsx) on made-up threads. Its promise:
 * no read of a real message or person, no write, no RPC, no edge function, no realtime channel, no navigation away.
 * This renders the preview for EVERY stage and both sides on the real stack (no mock of supabase-js or of the page's
 * hooks), checks that every read the page makes is answered from the sample, presses every button, and reads what
 * reached the network (the window fetch underneath the preview): nothing but sign-in traffic, the admin's own profile
 * or role row, and which feature switches are on. It also pins the route behind the same admin gate as /admin, in its
 * own lazy chunk, and proves a crash in the page still sends nothing.
 *
 * @mutate src/pages/admin/preview/messagesPreviewSamples.ts |       thread_pins: [],\n |
 * @mutate src/pages/admin/preview/previewParts.tsx |   client.channel = channel; |   void channel;
 * @mutate src/pages/admin/preview/MessagesPreviewPage.tsx |     const undoRealtime = installInertRealtime(); |     const undoRealtime = () => undefined;
 * @mutate src/pages/admin/preview/messagesPreviewSamples.ts |     opens: stage === "reported" ? ["Conversation options", "Report user"] : stage === "block_sheet" ? ["Conversation options", "Block user"] : null, |     opens: null,
 * @mutate src/App.tsx | <ProtectedRoute><AdminRoute><AdminMessagesPreview /></AdminRoute></ProtectedRoute> | <ProtectedRoute><AdminMessagesPreview /></ProtectedRoute>
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const toasts = vi.hoisted(() => [] as string[]);
vi.mock("sonner", async (orig) => {
  const real = await orig<typeof import("sonner")>();
  const t = Object.assign((msg: string) => { toasts.push(String(msg)); return msg; }, real.toast, {
    error: (msg: string) => { toasts.push(`error:${String(msg)}`); return msg; },
    success: (msg: string) => { toasts.push(`success:${String(msg)}`); return msg; },
    warning: (msg: string) => { toasts.push(`warning:${String(msg)}`); return msg; },
  });
  return { ...real, toast: t };
});
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "11111111-1111-4111-8111-111111111111" }, isLoading: false, isAdmin: true, adminStatus: "admin", profile: null, profileQuery: { status: "success", fetchStatus: "idle" }, refresh: async () => undefined }),
}));

import MessagesPreviewPage from "@/pages/admin/preview/MessagesPreviewPage";
import { MESSAGES_PREVIEW_STAGES } from "@/pages/admin/preview/messagesPreviewSamples";
import { messagesPreviewChecks } from "@/pages/admin/preview/messagesPreviewBackend";
import { supabase } from "@/integrations/supabase/client";
import { __resetBlockReadsForTests } from "@/lib/userBlocks";

const SUPABASE = String(import.meta.env.VITE_SUPABASE_URL);
let sent: Array<{ url: string; method: string }> = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  sent = [];
  toasts.length = 0;
  // The block read is shared for 2 s (userBlocks.ts); each stage reads its own sample's blocks.
  __resetBlockReadsForTests();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    sent.push({ url, method: (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase() });
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  messagesPreviewChecks.onUnlisted = undefined;
});

let where = "";
function Where() {
  const l = useLocation();
  where = l.pathname;
  return null;
}

function renderPreview(query: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/admin/preview/messages?${query}`]}>
        <Where />
        <Routes><Route path="/admin/preview/messages" element={<MessagesPreviewPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** What reached Supabase beyond sign-in, the admin's own profile/role read and the feature switches: must stay empty. */
function leaked() {
  return sent.filter((r) => {
    if (!r.url.startsWith(SUPABASE)) return false;
    const u = new URL(r.url);
    if (u.pathname.startsWith("/auth/v1/")) return false;
    if (u.pathname === "/rest/v1/rpc/feature_switches_for_me") return false;
    const ownRead = r.method === "GET" && /^\/rest\/v1\/(profiles|user_roles)$/.test(u.pathname) && [...u.searchParams.values()].includes(`eq.${ADMIN_ID}`);
    return !ownRead;
  });
}

function pressEveryButton() {
  const controls = document.querySelector("[data-preview-controls]");
  for (let pass = 0; pass < 2; pass++) {
    for (const b of Array.from(document.querySelectorAll<HTMLElement>("button, a[href]"))) {
      if (controls?.contains(b) || (b as HTMLButtonElement).disabled) continue;
      fireEvent.pointerDown(b);
      fireEvent.click(b);
    }
  }
}

/** The page's own words: everything on screen except the preview's controls (whose stage chips say "Blocked" ...). */
function pageText(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-preview-controls]").forEach((n) => n.remove());
  return clone.textContent ?? "";
}

/** What each stage must show once it has drawn (the page's own words for it). */
const SHOWS: Record<string, RegExp> = {
  // The inbox's rows are virtualized (no layout in jsdom); its unread count is the sample's two threads with unread rows.
  inbox: /Unread · [12]/,
  thread: /see you at 9/,
  // After a block Eli's thread (one of the poster's two unread threads) is gone: Maya's is the one unread left.
  blocked: /Unread · 1/,
  reported: /report/i,
  block_sheet: /block/i,
  empty: /no messages|nothing here|no conversations|start a conversation/i,
};

describe("admin Messages preview", () => {
  for (const { key } of MESSAGES_PREVIEW_STAGES) {
    for (const side of ["poster", "helpr"] as const) {
      it(`${key} as ${side}: draws from its sample alone and sends nothing, even with every button pressed`, async () => {
        const unlisted: string[] = [];
        messagesPreviewChecks.onUnlisted = (what) => unlisted.push(what);
        renderPreview(`stage=${key}&side=${side}`);
        await waitFor(() => expect(document.querySelector(`[data-preview-view="${key}:${side}"]`)).not.toBeNull());
        await waitFor(() => expect(pageText()).toMatch(SHOWS[key]), { timeout: 10000 });
        await new Promise((r) => setTimeout(r, 100));
        expect(document.querySelector("[data-preview-crashed]"), `${key}:${side} crashed`).toBeNull();
        expect([...new Set(unlisted)].sort(), `${key}:${side} reads its sample does not answer`).toEqual([]);
        messagesPreviewChecks.onUnlisted = undefined;
        pressEveryButton();
        await new Promise((r) => setTimeout(r, 50));
        expect(leaked()).toEqual([]);
        expect(where).toBe("/admin/preview/messages");
      }, 30000);
    }
  }

  it("a thread shows both people's messages; the other side sees the same thread from the Helpr's chair", async () => {
    renderPreview("stage=thread&side=poster");
    expect(await screen.findByText(/Are the bags in the shed\?/, undefined, { timeout: 10000 })).toBeInTheDocument();
    expect(screen.getByText(/The gate code is on the job page\./)).toBeInTheDocument();
    cleanup();
    renderPreview("stage=thread&side=helpr");
    expect(await screen.findByText(/Are the bags in the shed\?/, undefined, { timeout: 10000 })).toBeInTheDocument();
    expect(leaked()).toEqual([]);
  }, 30000);

  for (const [stage, words] of [["reported", /report/i], ["block_sheet", /block/i]] as const) {
    it(`${stage}: the sheet itself opens over the thread, and the dock steps aside while it is open`, async () => {
      renderPreview(`stage=${stage}&side=poster`);
      await waitFor(() => {
        const d = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).find((x) => words.test(x.textContent ?? ""));
        expect(d, `${stage}: its sheet`).toBeTruthy();
      }, { timeout: 10000 });
      await waitFor(() => expect(document.querySelector("[data-preview-controls]")).toBeNull());
      expect(leaked()).toEqual([]);
    }, 30000);
  }

  it("no realtime channel connects while the preview is open, and the client gets its own back after", async () => {
    const before = (supabase as unknown as { channel: unknown }).channel;
    const r = renderPreview("stage=thread&side=poster");
    await screen.findByText(/Are the bags in the shed\?/, undefined, { timeout: 10000 });
    const ch = supabase.channel("preview-probe") as unknown as { topic: string; subscribe: () => unknown };
    expect(ch.topic).toBe("preview-probe");
    expect((supabase as unknown as { channel: unknown }).channel).not.toBe(before);
    r.unmount();
    expect((supabase as unknown as { channel: unknown }).channel).toBe(before);
  }, 30000);

  it("Hide collapses the dock to one small button", async () => {
    renderPreview("stage=inbox&side=poster");
    await waitFor(() => expect(document.body.textContent ?? "").toMatch(/Unread · [12]/), { timeout: 10000 });
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    const dock = screen.getByRole("region", { name: "Messages preview controls" });
    expect(dock.hasAttribute("data-preview-collapsed")).toBe(true);
    expect(dock.querySelectorAll("button")).toHaveLength(1);
  }, 30000);

  it("is behind the same admin gate as /admin, in its own lazy chunk", () => {
    const app = blankComments(readFileSync(path.join(process.cwd(), "src/App.tsx"), "utf8"));
    const routes = app.split("\n").filter((l) => l.includes('path="/admin'));
    expect(routes.length).toBeGreaterThan(2);
    const preview = routes.find((l) => l.includes('path="/admin/preview/messages"'));
    expect(preview).toContain("<ProtectedRoute><AdminRoute><AdminMessagesPreview /></AdminRoute></ProtectedRoute>");
    expect(app).toMatch(/const AdminMessagesPreview = lazy\(\(\) => import\("\.\/pages\/admin\/preview\/MessagesPreviewPage"\)\)/);
  });
});
