// @mutate src/components/profile/SupportInline.tsx |     () => supportCategories.find((c) => c.key === searchParams.get("topic"))?.key ?? "message", |     () => "message",
// @mutate src/components/profile/SupportInline.tsx |         {bugContext && <BugReportAttachments context={bugContext} />} |         {null}
// @mutate src/components/profile/SupportInline.tsx |     const text = bugContext ? withBugReport(message.trim(), bugContext, BUG_REPORT_MAX_CHARS) : message.trim(); |     const text = message.trim();
// @mutate src/components/profile/profileLanding/useProfileLandingDerived.tsx | href: "/profile?tab=support&topic=report" }, | href: "/profile?tab=support" },
/*
 * Q1028 (owner, 2026-10-07): "Report a bug" on the Profile menu opens the
 * in-app support form on "Something's not working", shows what gets attached
 * BEFORE sending, and sends exactly that with the report.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const db = vi.hoisted(() => ({ inserted: [] as Record<string, unknown>[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        db.inserted.push(row);
        return { data: null, error: null };
      },
    }),
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  },
}));
vi.mock("@/lib/haptics", () => ({ hapticError: vi.fn(), hapticLight: vi.fn(), hapticSuccess: vi.fn(), hapticMedium: vi.fn() }));

import { SupportInline } from "@/components/profile/SupportInline";
import { _resetBugReportContext, noteRecentError, noteScreen } from "@/lib/bugReportContext";

beforeEach(() => {
  db.inserted = [];
  _resetBugReportContext();
});

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <SupportInline userId="u-1" onBack={() => {}} />
    </MemoryRouter>,
  );
}

describe("Report a bug: the in-app support form (Q1028)", () => {
  it("?topic=report opens on \"Something's not working\" and lists what gets attached", () => {
    noteScreen("/jobs/abc", "", "Fence repair · Helpr");
    renderAt("/profile?tab=support&topic=report");
    expect(screen.getAllByText("Something's not working").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Attached automatically" })).toBeTruthy();
    expect(screen.getByText("Fence repair · Helpr")).toBeTruthy();
    expect(screen.getByText("/jobs/abc")).toBeTruthy();
  });

  it("another topic attaches nothing", () => {
    renderAt("/profile?tab=support");
    expect(screen.queryByRole("heading", { name: "Attached automatically" })).toBeNull();
  });

  it("sends the shown context with the report", async () => {
    noteScreen("/home", "", "Home · Helpr");
    noteRecentError("TypeError: cannot read job", new Date("2026-10-07T05:10:00Z"));
    renderAt("/profile?tab=support&topic=report");
    fireEvent.change(screen.getByLabelText(/What went wrong\?/), { target: { value: "Save did nothing on the job card." } });
    fireEvent.submit(screen.getByLabelText(/What went wrong\?/).closest("form")!);
    await waitFor(() => expect(db.inserted).toHaveLength(1));
    const description = String(db.inserted[0].description);
    expect(description.startsWith("Save did nothing on the job card.\n\n--- Attached automatically ---")).toBe(true);
    expect(description).toContain("Screen: Home · Helpr");
    expect(description).toContain("Route: /home");
    expect(description).toContain("2026-10-07T05:10:00.000Z TypeError: cannot read job");
  });

  it("the Profile menu's \"Report a bug\" row opens exactly that form", () => {
    const src = readFileSync(join(__dirname, "profileLanding", "useProfileLandingDerived.tsx"), "utf8");
    expect(src).toMatch(/label: "Report a bug"[^\n]*href: "\/profile\?tab=support&topic=report" \}/);
    const help = readFileSync(join(__dirname, "..", "..", "pages", "info", "HelpCenter.tsx"), "utf8");
    expect(help).toMatch(/<Link to="\/support\?topic=report"[^>]*>\s*Report a bug\s*<\/Link>/);
  });
});
