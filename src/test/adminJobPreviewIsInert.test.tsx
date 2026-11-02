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
 * @mutate src/pages/admin/preview/JobPreviewPage.tsx |   if (sheetOpen) return null; |   if (sheetOpen) void 0;
 * @mutate src/pages/admin/preview/JobPreviewPage.tsx |   if (!open) { |   if (open === null) {
 * @mutate src/pages/admin/preview/jobPreviewSamples.ts |     opens: stage === "cancel_sheet" && viewer === "poster" ? "Cancel job" : null, |     opens: null,
 * @mutate src/pages/admin/preview/previewBackend.ts |      o.onUnlisted?.(`rpc ${name}`); |      void name;
 * @mutate src/pages/admin/preview/jobPreviewSamples.ts |       job_guarantee_claims: [],\n |
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
import { jobPreviewChecks } from "@/pages/admin/preview/previewBackend";

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
  jobPreviewChecks.onUnlisted = undefined;
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
 * and the read of which feature switches are on (previewBackend.ts: the app chrome and the admin gate keep their real
 * answer). Never a write, any other RPC, or a job.
 */
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

describe("admin job-page preview", () => {
  for (const { key } of PREVIEW_STAGES) {
    for (const viewer of ["poster", "helpr"] as const) {
      it(`${key} as ${viewer}: draws the job page from its sample alone and sends nothing to Supabase, even with every button pressed`, async () => {
        // Audit 1102b / 1102c P1: a read the sample does not answer draws a made-up state. Every read the page makes
        // as it draws must be in the sample.
        const unlisted: string[] = [];
        jobPreviewChecks.onUnlisted = (what) => unlisted.push(what);
        renderPreview(key, viewer);
        const title = previewSample(key, viewer).job.title;
        await screen.findAllByText(title, undefined, { timeout: 10000 });
        await new Promise((r) => setTimeout(r, 50));
        expect(document.querySelector("[data-preview-crashed]"), `${key}:${viewer} crashed`).toBeNull();
        expect([...new Set(unlisted)].sort(), `${key}:${viewer} reads its sample does not answer`).toEqual([]);
        jobPreviewChecks.onUnlisted = undefined;
        const start = where;
        pressEveryButton();
        await new Promise((r) => setTimeout(r, 50));
        expect(leaked()).toEqual([]);
        expect(where).toBe(start);
      }, 30000);
    }
  }

  it("a pressed action or link says what it would have done, and never navigates", async () => {
    renderPreview("working", "helpr");
    await screen.findAllByText(previewSample("working", "helpr").job.title, undefined, { timeout: 10000 });
    const start = where;
    // The sample's people are named on the page (get_safe_profiles and get_public_profile_stats answered from the sample).
    expect((await screen.findAllByLabelText("See the poster, Lexi L., 4.8 stars from 9 reviews")).length).toBeGreaterThan(0);
    // The hired Helpr's "Open in working" (under More options) is a navigation: it stays here and says where it would have gone.
    const more = screen.getAllByRole("button", { name: "More options" })[0];
    fireEvent.pointerDown(more);
    fireEvent.click(more);
    const open = (await screen.findAllByRole("button", { name: "Open in working" }))[0];
    fireEvent.pointerDown(open);
    fireEvent.click(open);
    expect(toasts).toContain(`Preview: this would open /jobs?tab=working&job=${previewSample("working", "helpr").jobId}&open=1.`);
    pressEveryButton();
    await waitFor(() => expect(toasts.filter((t) => t.startsWith("Preview: this would ")).length).toBeGreaterThan(1));
    expect(where).toBe(start);
    expect(leaked()).toEqual([]);
  }, 30000);

  it("a write the page makes (the poster's Confirm they've arrived) is answered here, never sent", async () => {
    renderPreview("arrived", "poster");
    const confirm = await screen.findByRole("button", { name: "Confirm they've arrived" }, { timeout: 10000 });
    fireEvent.pointerDown(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(toasts.some((t) => t.startsWith("Preview: this would ") && !t.startsWith("Preview: this would open"))).toBe(true));
    expect(leaked()).toEqual([]);
    expect(sent.filter((r) => r.method !== "GET")).toEqual([]);
  }, 30000);

  it("Q2617: Hide collapses the dock to one small button, and it comes back on a tap", async () => {
    renderPreview("hired", "poster");
    await screen.findAllByText(previewSample("hired", "poster").job.title, undefined, { timeout: 10000 });
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    const dock = screen.getByRole("region", { name: "Job page preview controls" });
    expect(dock.hasAttribute("data-preview-collapsed")).toBe(true);
    expect(dock.querySelectorAll("button")).toHaveLength(1);
    expect(screen.queryByRole("radiogroup", { name: "Stage" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("radiogroup", { name: "Stage" })).toBeInTheDocument();
  }, 30000);

  it("Q2617 + audit 1102b: the Cancel sheet stage opens the poster's cancel sheet, and the dock steps aside while it is open", async () => {
    const unlisted: string[] = [];
    jobPreviewChecks.onUnlisted = (what) => unlisted.push(what);
    renderPreview("cancel_sheet", "poster");
    // The cancel sheet itself (CancellationDialog, with its quote), not the More options list it is reached through.
    const sheet = await waitFor(() => {
      const d = screen.getAllByRole("dialog").find((x) => !/^More options/.test(x.textContent ?? ""));
      expect(d).toBeTruthy();
      return d as HTMLElement;
    }, { timeout: 10000 });
    expect(sheet.textContent ?? "").toMatch(/cancel/i);
    // Its quote is the late one (the start is about 3 hours away), drawn from the sample alone.
    expect(sheet.textContent ?? "").not.toMatch(/more than 24 hours away/);
    expect([...new Set(unlisted)]).toEqual([]);
    // Nothing of the preview sits over the sheet's buttons (at 375 the dock covered each sheet's second button).
    await waitFor(() => expect(document.querySelector("[data-preview-controls]")).toBeNull());
    expect(leaked()).toEqual([]);
  }, 30000);

  it("is behind the same admin gate as /admin, in its own lazy chunk", () => {
    const app = blankComments(readFileSync(path.join(process.cwd(), "src/App.tsx"), "utf8"));
    const routes = app.split("\n").filter((l) => l.includes('path="/admin'));
    expect(routes.length).toBeGreaterThan(1);
    const preview = routes.find((l) => l.includes('path="/admin/preview/job"'));
    expect(preview).toContain("<ProtectedRoute><AdminRoute><AdminJobPreview /></AdminRoute></ProtectedRoute>");
    expect(app).toMatch(/const AdminJobPreview = lazy\(\(\) => import\("\.\/pages\/admin\/preview\/JobPreviewPage"\)\)/);
  });
});
