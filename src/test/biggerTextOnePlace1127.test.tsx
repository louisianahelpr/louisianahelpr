/**
 * Polish audit 11-27 #134 (~/.lh-shots/polish-audit-1127/FINDINGS.md, home-account/tab-accessibility--in-390--1.png):
 * "Bigger text and buttons" was a switch on two screens, You › Settings › Look AND the Color and text screen that
 * Look's first row opens. It now lives only on Color and text; Settings keeps the row that opens it, and Help points
 * there. Inventory: every row drawn in Settings' Look group.
 *
 * @mutate src/components/profile/SettingsTab.tsx | <Group title="Look"> | <Group title="Look"><Row testId="bigger-text" label="Bigger text and buttons" />
 * @mutate src/pages/info/helpCenter/helpCenterContent.ts | Bigger text and buttons in You › Settings › Color and text. | Bigger text and buttons in You › Settings.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, within, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/pages/post-job/useSavedJobAddress", () => ({ useSavedJobAddress: () => ({ savedAddress: null, otherSavedAddresses: [] }) }));
vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: null, isAdmin: false }) }));
vi.mock("@/components/landing/useSectionsOpen", async (orig) => ({ ...(await orig<object>()), useOpenToEveryoneAnswer: () => null }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => k === "declutter" }));
vi.mock("@/hooks/useDarkMode", () => ({ useDarkMode: () => ({ theme: "system" }) }));
vi.mock("@/components/sections/useSectionPrefs", async () => {
  const { SECTIONS } = await import("@/components/sections/sectionsConfig");
  return { useSectionPrefs: () => ({ visible: SECTIONS, prefs: { order: SECTIONS.map((s) => s.key), hidden: [] }, setHidden: vi.fn(() => true) }) };
});

import { SettingsTab } from "@/components/profile/SettingsTab";
import { FAQ_SECTIONS } from "@/pages/info/helpCenter/helpCenterContent";
import { BIGGER_TEXT_LABEL } from "@/components/profile/biggerTextWords";

afterEach(cleanup);

describe("#134: Bigger text and buttons has one switch", () => {
  it("Settings › Look has no bigger-text switch, only the row that opens Color and text", () => {
    render(
      <MemoryRouter>
        <SettingsTab profile={null} onSelectTab={vi.fn()} onRequestLogout={vi.fn()} onBack={() => {}} />
      </MemoryRouter>,
    );
    const look = screen.getByRole("region", { name: "Look" });
    const rows = [...look.querySelectorAll("[data-settings-row]")].map((r) => r.getAttribute("data-settings-row"));
    expect(rows.length).toBeGreaterThan(1);
    expect(rows).toContain("color-mode");
    expect(rows).not.toContain("bigger-text");
    expect(within(look).queryByText(BIGGER_TEXT_LABEL)).toBeNull();
  });

  it("Help sends people to Color and text for it", () => {
    const answers = FAQ_SECTIONS.flatMap((s) => s.items).filter((i) => i.a.includes(BIGGER_TEXT_LABEL));
    expect(answers.length).toBeGreaterThan(0);
    for (const a of answers) expect(a.a).toMatch(/You › Settings › Color and text/);
  });
});
