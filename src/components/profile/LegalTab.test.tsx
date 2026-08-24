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
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn() }));
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
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
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

  it("still leads to the three anchor policy documents", () => {
    renderTab();
    // "Community Rules" is now the ONE name for this doc (it was "Platform
    // rules" here and "Community guidelines" in the jump list below), so the
    // matcher carries the row's body copy to tell the policy-document card
    // apart from the jump-list row that points at the same rules.
    expect(
      screen.getByRole("link", { name: /Community Rules How Helpr works/ }),
    ).toHaveAttribute("href", "/rules");
    expect(screen.getByRole("link", { name: /Terms of service/ })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: /Privacy policy/ })).toHaveAttribute("href", "/privacy");
  });
});
