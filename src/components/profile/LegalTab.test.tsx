import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LegalTab } from "./LegalTab";
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";
import { toast } from "sonner";

// GDPR Art. 20 portability is promised IN WRITING by the Privacy Policy
// ("Download a complete copy of your data … from Legal & policies in your
// profile"), so the export is a legal commitment, not a nice-to-have. It
// moved here from the standalone /data-rights page on 2026-08-18; these
// tests are what stops the move from having quietly broken it.

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
// `hapticLight` is pulled in by the shared <Tabs> primitive (ui/tabs.tsx fires
// a tick on every real selection change). Without it in this factory the mock
// shadows the real module with an undefined export and the first tab switch
// throws instead of switching documents.
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticLight: vi.fn() }));
vi.mock("@/hooks/useAuthReady", () => ({
  useAuthReady: () => ({ user: { id: "user-1" } }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));

const TABLE_DATA: Record<string, unknown> = {
  profiles: { user_id: "user-1", full_name: "Marie Boudreaux" },
  jobs: [{ id: "job-1", title: "Fix the fence" }],
  applications: [{ id: "app-1", helper_id: "user-1" }],
  reviews: [{ id: "rev-1", rating: 5 }],
};

/**
 * The export builds four queries whose terminal call differs — `profiles`
 * ends in `.maybeSingle()`, the other three are awaited straight off `.eq()`
 * / `.or()`. So the stub has to be BOTH chainable and thenable, or one of the
 * three list queries silently resolves to the builder object itself.
 */
function stubTable(table: string, error: unknown = null) {
  const result = { data: error ? null : TABLE_DATA[table], error };
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    or: () => builder,
    maybeSingle: () => Promise.resolve(result),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej),
  };
  return builder;
}

let createdBlobs: Blob[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  createdBlobs = [];
  vi.mocked(supabase.from).mockImplementation(
    ((table: string) => stubTable(table)) as unknown as typeof supabase.from,
  );
  // jsdom implements neither of these, and clicking a real <a download> would
  // emit a "navigation not implemented" error instead of running the assertion.
  URL.createObjectURL = vi.fn((blob: Blob) => {
    createdBlobs.push(blob);
    return "blob:mock";
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

/**
 * Radix's TabsTrigger selects on MOUSEDOWN (and on focus in its default
 * "automatic" activation mode) — not on click. `fireEvent.click` fires neither,
 * so it leaves the panel exactly where it was and every tab assertion below
 * would pass or fail for the wrong reason. Go through the event the primitive
 * actually listens for.
 */
const selectDoc = (name: string) =>
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });

// The policy documents are the REAL ones now (TermsContent et al), and Terms
// reads the live onboarding fee through React Query — so the tab needs a
// client the way the app gives it one. Without it `useOnboardingFeeCents`
// throws "No QueryClient set" and every assertion below fails for a reason
// that has nothing to do with legal copy.
const renderTab = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <LegalTab onBack={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("Legal & policies — data rights", () => {
  it("offers the data export the Privacy Policy links here for", () => {
    renderTab();
    expect(screen.getByRole("heading", { name: "Download your data" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download My Data" })).toBeEnabled();
  });

  it("keeps the GDPR/CCPA footnote with the control", () => {
    renderTab();
    expect(screen.getByText(/Under the EU GDPR and California CCPA/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "contact support" })).toHaveAttribute("href", "/support");
  });

  it("exports profile, jobs, applications and reviews as one JSON file", async () => {
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: "Download My Data" }));
    await waitFor(() => expect(createdBlobs).toHaveLength(1));

    expect(createdBlobs[0].type).toBe("application/json");
    const payload = JSON.parse(await createdBlobs[0].text());
    expect(payload).toMatchObject({
      profile: TABLE_DATA.profiles,
      jobs: TABLE_DATA.jobs,
      applications: TABLE_DATA.applications,
      reviews: TABLE_DATA.reviews,
    });
    expect(payload.exported_at).toEqual(expect.any(String));
    // The object URL is still revoked — but `saveOrShareFile` now defers it by
    // ~1s (nativeShare.ts) rather than revoking on the same tick. Revoking
    // immediately after `.click()` can abort the download in Safari, so the
    // delay is deliberate. Kept as an assertion rather than dropped: an
    // un-revoked blob URL pins the whole export in memory for the session.
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock"), {
      timeout: 2000,
    });
  });

  it("surfaces a Supabase failure instead of downloading a file full of nulls", async () => {
    vi.mocked(supabase.from).mockImplementation(
      ((table: string) =>
        stubTable(table, table === "reviews" ? { message: "permission denied" } : null)) as unknown as typeof supabase.from,
    );
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: "Download My Data" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());

    expect(createdBlobs).toHaveLength(0);
    expect(report).toHaveBeenCalledWith(
      { message: "permission denied" },
      { tags: { source: "LegalTab.exportData" } },
    );
    // The button must come back, not stay stuck in "Preparing…".
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Download My Data" })).toBeEnabled(),
    );
  });

  it("keeps the data export reachable from where /data-rights lands", () => {
    // /data-rights redirects to `/profile?tab=legal` with NO ?doc= (App.tsx),
    // so it opens the DEFAULT document panel. The Privacy Policy and the iOS
    // App Store privacy listing both point at that URL in writing, so the
    // export has to be on screen there — i.e. outside the document tab band,
    // not tucked inside the Privacy panel where the default view never shows
    // it. Assert it while the default (Terms) panel is the one open.
    renderTab();
    expect(screen.getByRole("tab", { name: "Terms" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Download your data" })).toBeInTheDocument();
  });
});

describe("Legal & policies — the same documents the signed-out page shows", () => {
  /* Owner, repeatedly, latterly 2026-09-11: "how many times have i said this
     needs to b similar to the logged out screens yet it looks nothing like
     it." The tab used to render a DIRECTORY — a "Read the full terms of
     service" card per document plus deep links — which sent a signed-in user
     back out to the public /legal page, the exact bounce banned on
     2026-08-30. It now renders the policy text itself, from the same
     components pages/Legal.tsx mounts.

     These assertions are about CONTENT, not about the render succeeding: the
     old suite passed while the screen showed link cards, because it only ever
     asked about link cards. */

  it("renders the Terms of Service text itself, not a link to it", () => {
    renderTab();
    expect(screen.getByRole("heading", { name: /^Eligibility & accounts/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Payment, escrow & fees/ })).toBeInTheDocument();
  });

  it("sends nobody back out to the public legal pages", () => {
    // The whole defect: every route out of here was a hop to /legal, /terms,
    // /rules or /privacy — public pages, from inside the signed-in app.
    renderTab();
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href") ?? "").not.toMatch(/^\/(legal|terms|rules|privacy)\b/);
    }
  });

  it("puts each policy one tap away, with exactly one mounted at a time", () => {
    renderTab();
    expect(screen.getByRole("tab", { name: "Terms" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("heading", { name: /^The basics/ })).toBeNull();

    selectDoc("Rules");
    expect(screen.getByRole("heading", { name: /^The basics/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Posting & accepting jobs/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Eligibility & accounts/ })).toBeNull();

    selectDoc("Privacy");
    expect(screen.getByRole("heading", { name: /^Information we collect/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^The basics/ })).toBeNull();
  });

  it("keeps the export on screen whichever document is open", () => {
    // It is a control, not a policy, so it sits outside the band — and the
    // /data-rights promise above depends on it never being hidden behind one.
    renderTab();
    for (const tab of ["Rules", "Privacy", "Terms"]) {
      selectDoc(tab);
      expect(screen.getByRole("button", { name: "Download My Data" })).toBeInTheDocument();
    }
  });
});
