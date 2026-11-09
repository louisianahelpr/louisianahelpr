/**
 * F150 (owner UI audit 11-09): the floating "+ Create" / "+ Sell" / "+ Post a job" pills sat on card text (e.g.
 * "3 mi away · Porch pickup"). Owner's fix: "Bottom padding = dock + floating button height". Every list that scrolls
 * under a pill ends that much higher:
 *   - SectionScreen (Home, Declutter, Shops, Homes) adds pb-20 under its last row when it has a `fab`;
 *   - Jobs (PageScaffold, not SectionScreen: the feed and the Posted / Working lists) add --section-fab-clearance,
 *     which <html class="has-section-fab"> sets while a SectionCreateFab is on screen.
 * Measured at 375 (cwv-lab --scroll-end, ~/.lh-shots/ui-audit-1109/fixes/f150/): the text under the pill at the end.
 *
 * @mutate src/components/sections/SectionCreateFab.tsx |     document.documentElement.classList.add("has-section-fab"); |     void 0;
 * @mutate src/components/job-card/JobListPage.tsx |  + ${toastClearance}px + var(--section-fab-clearance, 0px))` }} |  + ${toastClearance}px)` }}
 * @mutate src/components/dashboard/MainFeedSection.tsx | var(--safe-area-bottom, 0px) + var(--section-fab-clearance, 0px))" }} | var(--safe-area-bottom, 0px))" }}
 * @mutate src/index.css | html.has-section-fab { --section-fab-clearance: 4rem; } | html.has-section-fab { --section-fab-clearance: 1rem; }
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const view = vi.hoisted(() => ({ desktop: false }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => view.desktop }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ gate: (_k: string, f: () => void) => f, gatedProps: () => ({}) }) }));
vi.mock("@/lib/haptics", () => ({ hapticMedium: () => {} }));

import { SectionCreateFab } from "@/components/sections/SectionCreateFab";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => blankComments(readFileSync(join(ROOT, p), "utf8"));
const css = readFileSync(join(ROOT, "src/index.css"), "utf8");

afterEach(() => { cleanup(); view.desktop = false; });

describe("a list ends above the floating create pill (F150)", () => {
  it("while a pill shows, <html> wears has-section-fab; it leaves with the pill; never on the desktop website", () => {
    const html = document.documentElement;
    const { unmount } = render(<MemoryRouter><SectionCreateFab section="jobs" text="Post a job" /></MemoryRouter>);
    expect(html.classList.contains("has-section-fab")).toBe(true);
    unmount();
    expect(html.classList.contains("has-section-fab")).toBe(false);
    view.desktop = true;
    render(<MemoryRouter><SectionCreateFab section="jobs" text="Post a job" /></MemoryRouter>);
    expect(html.classList.contains("has-section-fab")).toBe(false);
  });

  it("the clearance is the pill's height plus its gap over the dock (Button md h-12 = 48px, + 16px)", () => {
    expect(read("src/components/ui/button.tsx")).toMatch(/md: "h-12 /);
    expect(read("src/components/sections/SectionCreateFab.tsx")).toMatch(/size="md"[\s\S]{0,400}bottom-safe-nav/);
    expect(css).toContain("html.has-section-fab { --section-fab-clearance: 4rem; }");
  });

  it("every Jobs list under the pill adds the clearance; SectionScreen keeps its pb-20", () => {
    const users = ["src/components/job-card/JobListPage.tsx", "src/components/dashboard/MainFeedSection.tsx", "src/components/dashboard/BrowseTasksFeed.tsx"];
    for (const f of users) expect(read(f), f).toMatch(/paddingBottom:[^\n]*var\(--section-fab-clearance, 0px\)/);
    expect(read("src/components/sections/SectionScreen.tsx")).toMatch(/\$\{fab \? "pb-20" : "pb-6"\}/);
    expect(read("src/pages/jobs/JobsSection.tsx")).toMatch(/<SectionCreateFab section="jobs"/);
  });
});
