/**
 * Owner answer 12 (2026-10-17): quote requests are found through a Quotes link
 * in the menu (and the "Wants quotes" browse filter, docs/OPEN.md), only while
 * the hidden 'quotes' switch is on for the member. The phone menu entry is the
 * Profile landing row (as Declutter's); the desktop rail lists it as a
 * destination (DesktopSidebarNav, asserted on its source below because the
 * rail renders only on the wide desktop website).
 *
 * @mutate src/components/profile/profileLanding/QuotesEntryRow.tsx |   if (!on) return null; |   if (false) return null;
 * @mutate src/components/profile/ProfileLanding.tsx |       <QuotesEntryRow />\n | \n
 * @mutate src/components/DesktopSidebarNav.tsx |     ...(quotesOn ? [{ path: "/quotes", icon: FileText, label: "Quotes" }] : []), |     ...[],
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "@/test/helpers/blankNonCode";

const state = vi.hoisted(() => ({ feature: false }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (key: string) => (key === "quotes" ? state.feature : false) }));

import { QuotesEntryRow } from "@/components/profile/profileLanding/QuotesEntryRow";

const root = resolve(__dirname, "../../..");
const src = (rel: string) => blankComments(readFileSync(resolve(root, rel), "utf8"));

describe("the Quotes menu link (owner answer 12)", () => {
  it("renders nothing while the switch is off", () => {
    state.feature = false;
    const { container } = render(<MemoryRouter><QuotesEntryRow /></MemoryRouter>);
    expect(container.innerHTML).toBe("");
  });

  it("links to /quotes while the switch is on", () => {
    state.feature = true;
    render(<MemoryRouter><QuotesEntryRow /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /Quotes/ }).getAttribute("href")).toBe("/quotes");
  });

  it("is on the Profile landing (phone menu) and the desktop rail, behind the switch", () => {
    expect(src("src/components/profile/ProfileLanding.tsx")).toMatch(/<QuotesEntryRow \/>/);
    const rail = src("src/components/DesktopSidebarNav.tsx");
    expect(rail).toContain('const quotesOn = useFeature("quotes");');
    expect(rail).toContain('...(quotesOn ? [{ path: "/quotes", icon: FileText, label: "Quotes" }] : []),');
    // /quotes keeps the signed-in app chrome on both surfaces (dualSurfaceRoutesGetAppChrome).
    expect(src("src/lib/desktopNavRoutes.ts")).toContain('"/quotes"');
    expect(src("src/components/mobileNav/mobileNavHelpers.ts")).toContain('"/quotes"');
  });
});
