/**
 * A3-I4 (app audit 2026-10-28): Settings › "Download my data" opened the whole
 * Privacy policy, and the member then had to find the export card's button at
 * the bottom of it. The row now runs the export itself, through the same hook
 * the Privacy policy's card uses (useDataExport), so the two cannot drift.
 *
 * @mutate src/components/profile/SettingsTab.tsx | onClick={() => void dataExport.startExport()} | onClick={() => navigate(dataRightsTarget(true))}
 * @mutate src/pages/info/legal/DataExportCard.tsx | const { exporting, startExport } = useDataExport(userId); | const { exporting, startExport } = { exporting: false, startExport: async () => {} };
 * @mutate src/hooks/useDataExport.ts |     if (!userId \|\| running.current) return; |     if (!userId) return;
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: null, isAdmin: false }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
// useSectionTabs reads the session (AUD31-73: a guest's open sections); this member is signed in.
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useDarkMode", () => ({ useDarkMode: () => ({ theme: "system" }) }));

import { SettingsTab } from "@/components/profile/SettingsTab";

let blobs: Blob[] = [];
beforeEach(() => {
  blobs = [];
  let release: (v: unknown) => void = () => {};
  invoke.mockReset().mockImplementation(() => new Promise((r) => { release = r; }).then(() => ({ data: { exported_at: "2026-10-29T00:00:00Z", user_id: "u1" }, error: null })));
  (globalThis as { __release?: () => void }).__release = () => release(null);
  URL.createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return "blob:mock"; });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Where() {
  return <span data-testid="where">{useLocation().pathname + useLocation().search}</span>;
}

function renderSettings() {
  render(
    <MemoryRouter initialEntries={["/profile?tab=settings"]}>
      <SettingsTab profile={null} seniorMode={false} onToggleSeniorMode={() => {}} onSelectTab={() => {}} onRequestLogout={() => {}} onBack={() => {}} />
      <Where />
    </MemoryRouter>,
  );
}

describe("A3-I4: Settings › Download my data downloads directly", () => {
  it("runs the export in place: one server call, a JSON file, no trip to the Privacy policy", async () => {
    renderSettings();
    const row = screen.getByText("Download my data").closest("button") as HTMLButtonElement;
    fireEvent.click(row);
    // A second tap while it runs does not start a second export.
    fireEvent.click(row);
    await waitFor(() => expect(row.getAttribute("aria-busy")).toBe("true"));
    expect(row.textContent).toMatch(/Preparing/);
    (globalThis as { __release?: () => void }).__release?.();
    await waitFor(() => expect(blobs).toHaveLength(1));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("export-my-data");
    expect(blobs[0].type).toBe("application/json");
    expect(screen.getByTestId("where").textContent).toBe("/profile?tab=settings");
    // The row was busy (asserted above); it goes back to its resting line once the file is out.
    await waitFor(() => expect(row.textContent).toMatch(/A copy of what Helpr holds about you/));
    expect(row.getAttribute("aria-busy")).toBeNull();
  });

  it("the Privacy policy's card and the Settings row share one export (useDataExport)", () => {
    const files = ["src/pages/info/legal/DataExportCard.tsx", "src/components/profile/SettingsTab.tsx"];
    expect(files.length).toBeGreaterThan(1);
    for (const f of files) {
      const src = blankComments(readFileSync(resolve(__dirname, "../..", f), "utf8"));
      expect(src).toMatch(/useDataExport\(/);
      expect(src).not.toMatch(/functions\.invoke\("export-my-data"\)/);
    }
  });
});
