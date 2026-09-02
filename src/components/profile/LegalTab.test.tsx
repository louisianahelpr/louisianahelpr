import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

const renderTab = () =>
  render(
    <MemoryRouter>
      <LegalTab onBack={() => {}} />
    </MemoryRouter>,
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

describe("Legal & policies — one document per surface", () => {
  // Owner, 2026-08-31: "Legal is still all tangled together. Should be similar
  // to the public legal pages." The tab used to STACK all three documents in
  // one scroll behind "1/3" / "2/3" / "3/3" headings, so reaching Terms meant
  // scrolling past seven Community Rules anchors. It now wears /legal's shape:
  // a Terms / Rules / Privacy band with exactly one document mounted.

  it("opens on Terms of service — zero taps, matching /legal's default tab", () => {
    renderTab();
    expect(
      screen.getByRole("link", { name: /Read the full terms of service/ }),
    ).toHaveAttribute("href", "/terms");
    // The other two documents are not merely below the fold — they are not
    // rendered at all, which is what stops them tangling.
    expect(screen.queryByRole("link", { name: /Read the full community rules/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Read the full privacy policy/ })).toBeNull();
  });

  it("drops the 1/3 · 2/3 · 3/3 counters that admitted the stacking", () => {
    renderTab();
    expect(screen.queryByText("1/3")).toBeNull();
    expect(screen.queryByText("2/3")).toBeNull();
    expect(screen.queryByText("3/3")).toBeNull();
  });

  it("still leads to all three anchor policy documents, one tap each", () => {
    renderTab();
    // Each panel opens with a "Read the full …" card. The matcher carries the
    // row's body copy too, so the Community Rules card is told apart from a
    // section shortcut pointing at the same rules.
    expect(
      screen.getByRole("link", { name: /Read the full terms of service/ }),
    ).toHaveAttribute("href", "/terms");

    selectDoc("Rules");
    expect(
      screen.getByRole("link", { name: /Read the full community rules How Helpr works/ }),
    ).toHaveAttribute("href", "/rules");

    selectDoc("Privacy");
    expect(
      screen.getByRole("link", { name: /Read the full privacy policy/ }),
    ).toHaveAttribute("href", "/privacy");
  });

  it("mounts only the open document's section shortcuts", () => {
    renderTab();
    // Terms' own two anchors are present…
    expect(
      screen.getByRole("link", { name: /Platform fees & the split fee model/ }),
    ).toHaveAttribute("href", "/legal?tab=terms#payment-escrow-fees");
    expect(
      screen.getByRole("link", { name: /Membership tiers & pricing/ }),
    ).toHaveAttribute("href", "/legal?tab=terms#subscription-tiers");
    // …and none of Community Rules' seven can be mistaken for one of them,
    // because they are not in the document.
    expect(screen.queryByRole("link", { name: /Cancellations, response times & no-shows/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Strikes, bans & how we detect violations/ })).toBeNull();

    selectDoc("Rules");
    expect(
      screen.getByRole("link", { name: /Cancellations, response times & no-shows/ }),
    ).toHaveAttribute("href", "/legal?tab=community#cancellations");
    expect(screen.queryByRole("link", { name: /Platform fees & the split fee model/ })).toBeNull();
  });

  it("preserves every deep link, one for one, across the three panels", () => {
    // The anchors are consent-referenced navigation into legally load-bearing
    // copy: the restructure is allowed to move them between panels, never to
    // change or lose one. This is the full manifest.
    renderTab();
    const hrefFor = (name: RegExp) =>
      screen.getByRole("link", { name }).getAttribute("href");

    expect(hrefFor(/Platform fees & the split fee model/)).toBe("/legal?tab=terms#payment-escrow-fees");
    expect(hrefFor(/Membership tiers & pricing/)).toBe("/legal?tab=terms#subscription-tiers");

    selectDoc("Rules");
    expect(hrefFor(/The basics/)).toBe("/legal?tab=community#basics");
    expect(hrefFor(/Budget limits, editing & new-Helpr limits/)).toBe("/legal?tab=community#posting-accepting");
    expect(hrefFor(/Cancellations, response times & no-shows/)).toBe("/legal?tab=community#cancellations");
    expect(hrefFor(/How your payment is held & released/)).toBe("/legal?tab=community#escrow-release");
    expect(hrefFor(/Revisions, disputes & admin review/)).toBe("/legal?tab=community#disputes");
    expect(hrefFor(/Strikes, bans & how we detect violations/)).toBe("/legal?tab=community#strikes-bans");
    expect(hrefFor(/Money & taxes/)).toBe("/legal?tab=community#money-taxes");
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
