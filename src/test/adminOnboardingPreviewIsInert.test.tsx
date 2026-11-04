/**
 * Q2664 (b) (audit 1102d): the sign-up screens after step 2 that no test account can reach without a write (the
 * unfinished Complete your profile form, the first-run picker) are drawn by /admin/preview/onboarding, inertly:
 *  - the form draws on a blank sample profile held in the preview's own cache, never the admin's real (finished)
 *    one, which would send the page to /home; the app's own cache entry is never changed;
 *  - the picker's Continue never reorders the admin's own Home (no helpr_section_prefs write), and the coach marks
 *    follow;
 *  - nothing reaches the network: every Supabase request the screens make is answered by the preview backend.
 *
 * @mutate src/components/firstRun/FirstRun.tsx |           if (onPicks) onPicks( |           if (onPicks) putFirst(
 * @mutate src/pages/admin/preview/OnboardingPreviewPage.tsx |     if (me) { |     if (!me) {
 * @mutate src/pages/admin/preview/OnboardingPreviewPage.tsx | { updatedAt: Date.now() + NEVER_STALE } | { updatedAt: 0 }
 * @mutate src/pages/admin/preview/messagesPreviewBackend.ts | (OWN_ROW_TABLES.has(table) \|\| o.ownRowTables?.includes(table)) | (OWN_ROW_TABLES.has(table) \|\| !!o.ownRowTables)
 * @mutate src/pages/admin/preview/messagesPreviewBackend.ts |     if (!base \|\| !url.startsWith(base)) return o.realFetch(input, init); |     if (base) return o.realFetch(input, init);
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

const ME = "11111111-1111-4111-8111-111111111111";
const USER = { id: ME, email: "admin@example.com", app_metadata: { provider: "email" }, user_metadata: {} };
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: USER, session: null, isReady: true }) }));

const SUPABASE = String(import.meta.env.VITE_SUPABASE_URL);
const realFetch = globalThis.fetch;
let spy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  spy = vi.fn(async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }));
  globalThis.fetch = spy as unknown as typeof fetch;
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

import OnboardingPreviewPage from "@/pages/admin/preview/OnboardingPreviewPage";

/**
 * Supabase requests that reached the network, less the two reads the preview passes on purpose: which switches are
 * on (feature_switches_for_me) and a GET of the admin's OWN Home-order row (so the real row still wins afterwards).
 */
const supabaseCalls = () =>
  spy.mock.calls
    .map(([u, init]) => `${String((init as RequestInit | undefined)?.method ?? "GET")} ${String(u instanceof Request ? u.url : u)}`)
    .filter((c) => c.includes(SUPABASE) && !c.includes("/auth/v1/"))
    .filter((c) => !c.endsWith("/rest/v1/rpc/feature_switches_for_me"))
    .filter((c) => !(c.startsWith("GET ") && c.includes("/rest/v1/member_section_prefs?") && c.endsWith(`user_id=eq.${ME}`)));

/** The admin's real, finished profile, in the APP's cache (what useCurrentUser reads outside the preview). */
const FINISHED = { user_id: ME, first_name: "Lexi", last_name: "Admin", full_name: "Lexi Admin", location: "Abbeville", accepted_terms_at: "2026-10-01T00:00:00Z", signup_completed_at: "2026-10-01T00:00:00Z" };

function renderAt(stage: string) {
  const app = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  app.setQueryData(queryKeys.currentUser.byId(ME), { profile: FINISHED, isAdmin: true, adminCheckFailed: false }, { updatedAt: Date.now() + 1e9 });
  const r = render(
    <QueryClientProvider client={app}>
      <MemoryRouter initialEntries={[`/admin/preview/onboarding?stage=${stage}`]}>
        <Routes>
          <Route path="/admin/preview/onboarding" element={<OnboardingPreviewPage />} />
          <Route path="/home" element={<p>Real home page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { app, ...r };
}

describe("admin onboarding preview (Q2664 b)", () => {
  it("draws the unfinished Complete your profile form on the sample, never the admin's own profile", async () => {
    const { app, unmount } = renderAt("profile");
    expect(await screen.findByRole("region", { name: "Onboarding preview controls" })).toBeInTheDocument();
    // The form itself (its name fields), not the redirect a finished account gets.
    await waitFor(() => expect(document.querySelectorAll("input").length).toBeGreaterThan(1), { timeout: 5000 });
    expect(screen.queryByText("Real home page")).toBeNull();
    expect((document.querySelector("input") as HTMLInputElement).value).toBe("");
    // The app's own entry is the real one, untouched.
    expect((app.getQueryData(queryKeys.currentUser.byId(ME)) as { profile: typeof FINISHED }).profile.first_name).toBe("Lexi");
    expect(supabaseCalls()).toEqual([]);
    unmount();
    expect(globalThis.fetch).toBe(spy);
  });

  it("draws the first-run picker; Continue leaves the admin's Home order alone and the coach marks follow", async () => {
    renderAt("picker");
    expect(await screen.findByText("What brings you to Helpr?", {}, { timeout: 5000 })).toBeInTheDocument();
    const before = localStorage.getItem(`helpr_section_prefs:${ME}`);
    const options = document.querySelectorAll<HTMLButtonElement>("[data-first-run-option]");
    expect(options.length).toBeGreaterThan(1);
    fireEvent.click(options[options.length - 1]);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Continue" })); });
    expect(await screen.findByText("Home shows what needs you")).toBeInTheDocument();
    expect(localStorage.getItem(`helpr_section_prefs:${ME}`)).toBe(before);
    expect(supabaseCalls()).toEqual([]);
  });
});

describe("preview backend ownRowTables (Q2664 b)", () => {
  it("sends only a GET of the admin's own row of a listed table; another table's own row and any write stay home", async () => {
    const { installMessagesPreviewFetch } = await import("@/pages/admin/preview/messagesPreviewBackend");
    const { uninstall } = installMessagesPreviewFetch({
      supabaseUrl: SUPABASE, sample: () => ({ reads: {}, tables: {} }), ownUserId: () => ME,
      ownRowTables: ["member_section_prefs"], onBlocked: () => {},
    });
    try {
      await fetch(`${SUPABASE}/rest/v1/member_section_prefs?select=section_order&user_id=eq.${ME}`);
      await fetch(`${SUPABASE}/rest/v1/notifications?select=*&user_id=eq.${ME}`);
      await fetch(`${SUPABASE}/rest/v1/member_section_prefs?user_id=eq.${ME}`, { method: "PATCH", body: "{}" });
    } finally {
      uninstall();
    }
    const sent = spy.mock.calls.map(([u]) => new URL(String(u)).pathname);
    expect(sent).toEqual(["/rest/v1/member_section_prefs"]);
  });
});
