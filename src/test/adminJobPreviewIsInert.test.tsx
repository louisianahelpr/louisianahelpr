/**
 * THE ADMIN JOB-PAGE PREVIEW NEVER TOUCHES A REAL JOB (owner 2026-11-01: "is there a way I can just test clicking each
 * section of the steps to see each stage of this").
 *
 * /admin/preview/job draws the real member job page (jobPage/JobPage.tsx) on made-up data. Its promise: no read of a
 * real job, no write, no RPC, no edge function, no navigation away. This renders the preview for EVERY stage and both
 * sides on the real stack (no mock of supabase-js or of the job page's hooks), presses every button the page draws,
 * and reads what reached the network (the window fetch underneath the preview): nothing but sign-in traffic may have.
 * It also pins the route behind the same admin gate as /admin, in its own lazy chunk.
 *
 * @mutate src/pages/admin/preview/previewBackend.ts | if (!base \|\| !url.startsWith(base)) return o.realFetch(input, init); | if (base) return o.realFetch(input, init);
 * @mutate src/pages/admin/preview/JobPreviewPage.tsx | push: (to: To) => sayWouldHave(`open ${toText(to)}`), | push: outer.navigator.push,
 * @mutate src/App.tsx | <ProtectedRoute><AdminRoute><AdminJobPreview /></AdminRoute></ProtectedRoute> | <ProtectedRoute><AdminJobPreview /></ProtectedRoute>
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const toasts = vi.hoisted(() => [] as string[]);
vi.mock("sonner", async (orig) => {
  const real = await orig<typeof import("sonner")>();
  const t = Object.assign((msg: string) => { toasts.push(String(msg)); return msg; }, real.toast, {
    error: (msg: string) => { toasts.push(`error:${String(msg)}`); return msg; },
    success: (msg: string) => { toasts.push(`success:${String(msg)}`); return msg; },
  });
  return { ...real, toast: t };
});
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "11111111-1111-4111-8111-111111111111" }, isLoading: false, isAdmin: true, adminStatus: "admin", profile: null, profileQuery: { status: "success", fetchStatus: "idle" }, refresh: async () => undefined }),
}));

import JobPreviewPage from "@/pages/admin/preview/JobPreviewPage";
import { PREVIEW_STAGES, previewSample } from "@/pages/admin/preview/jobPreviewSamples";

const SUPABASE = String(import.meta.env.VITE_SUPABASE_URL);
let sent: Array<{ url: string; method: string }> = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  // jsdom has no element scrolling; a time-picker wheel a pressed button opens scrolls itself.
  Element.prototype.scrollTo = function scrollTo() {};
  sent = [];
  toasts.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    sent.push({ url, method: (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase() });
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

let where = "";
function Where() {
  where = useLocation().pathname + useLocation().search;
  return null;
}

function renderPreview(stage: string, viewer: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/admin/preview/job?stage=${stage}&viewer=${viewer}`]}>
        <Where />
        <Routes><Route path="/admin/preview/job" element={<JobPreviewPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
/**
 * What reached Supabase: must stay empty, except sign-in traffic and a READ of the admin's own profile or role row
 * (previewBackend.ts: the app chrome and the admin gate keep their real answer). Never a write, an RPC or a job.
 */
function leaked() {
  return sent.filter((r) => {
    if (!r.url.startsWith(SUPABASE)) return false;
    const u = new URL(r.url);
    if (u.pathname.startsWith("/auth/v1/")) return false;
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

describe("admin job-page preview", () => {
  for (const { key } of PREVIEW_STAGES) {
    for (const viewer of ["poster", "helpr"] as const) {
      it(`${key} as ${viewer}: draws the job page and sends nothing to Supabase, even with every button pressed`, async () => {
        renderPreview(key, viewer);
        const title = previewSample(key, viewer).job.title;
        await screen.findAllByText(title, undefined, { timeout: 4000 });
        const start = where;
        pressEveryButton();
        await new Promise((r) => setTimeout(r, 50));
        expect(leaked()).toEqual([]);
        expect(where).toBe(start);
      }, 15000);
    }
  }

  it("a pressed action or link says what it would have done, and never navigates", async () => {
    renderPreview("working", "helpr");
    await screen.findAllByText(previewSample("working", "helpr").job.title, undefined, { timeout: 4000 });
    const start = where;
    // The hired Helpr's "Open in working" is a navigation: it stays here and says where it would have gone.
    const open = screen.getAllByRole("button", { name: "Open in working" })[0];
    fireEvent.pointerDown(open);
    fireEvent.click(open);
    expect(toasts).toContain(`Preview: this would open /jobs?tab=working&job=${previewSample("working", "helpr").jobId}&open=1.`);
    pressEveryButton();
    await waitFor(() => expect(toasts.filter((t) => t.startsWith("Preview: this would ")).length).toBeGreaterThan(1));
    expect(where).toBe(start);
    expect(leaked()).toEqual([]);
  }, 15000);

  it("a write the page makes (the poster's Confirm they've arrived) is answered here, never sent", async () => {
    renderPreview("arrived", "poster");
    const confirm = await screen.findByRole("button", { name: "Confirm they've arrived" }, { timeout: 4000 });
    fireEvent.pointerDown(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(toasts.some((t) => t.startsWith("Preview: this would ") && !t.startsWith("Preview: this would open"))).toBe(true));
    expect(leaked()).toEqual([]);
    expect(sent.filter((r) => r.method !== "GET")).toEqual([]);
  }, 15000);

  it("is behind the same admin gate as /admin, in its own lazy chunk", () => {
    const app = blankComments(readFileSync(path.join(process.cwd(), "src/App.tsx"), "utf8"));
    const routes = app.split("\n").filter((l) => l.includes('path="/admin'));
    expect(routes.length).toBeGreaterThan(1);
    const preview = routes.find((l) => l.includes('path="/admin/preview/job"'));
    expect(preview).toContain("<ProtectedRoute><AdminRoute><AdminJobPreview /></AdminRoute></ProtectedRoute>");
    expect(app).toMatch(/const AdminJobPreview = lazy\(\(\) => import\("\.\/pages\/admin\/preview\/JobPreviewPage"\)\)/);
  });
});
