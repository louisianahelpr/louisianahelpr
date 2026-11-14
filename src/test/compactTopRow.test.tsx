/**
 * THE COMPACT TOP (owner 11-14, after Depop's and Vinted's iPhone screens: "I think we need to make our top part more
 * like theirs so we can have more space"). On a phone, a main tab page with a search (Jobs, Declutter, Messages, Home)
 * has NO visible page-title row: ONE row, the search (flex-1) with the bell and the photo inline on its right, 8px under
 * the safe area. The page's name stays a visually hidden h1. A page with no search (You) keeps its visible title.
 * Every loading frame that hand-draws the row (Jobs, Home, Messages) reads the same COMPACT_TOP_ROW.
 *
 * @mutate src/components/sections/AppTopBar.tsx |             {title && <h1 className="sr-only">{title}</h1>} |             {title && <h1 className="text-page-title">{title}</h1>}
 * @mutate src/components/sections/AppTopBar.tsx |         search ? ( |         false ? (
 * @mutate src/components/sections/browseHeaderSpacing.ts | export const COMPACT_TOP_ROW = "app-top-bar flex items-center gap-1 pt-2 pb-0.5"; | export const COMPACT_TOP_ROW = "app-top-bar flex items-center gap-1 pt-4 pb-0.5";
 * @mutate src/components/messages/ConversationList.tsx | <AppTopBar title={t("msg.title")} desktopGap={false} search={phoneSearchRow} /> | <AppTopBar title={t("msg.title")} desktopGap={false} />
 * @mutate src/components/JobsSectionSkeleton.tsx |             <div className={COMPACT_TOP_ROW}> |             <div className="app-top-bar flex items-center justify-between gap-2 h-16">
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/integrations/supabase/client", async () => (await import("./helpers/emptySupabaseClient")).emptySupabaseModule());
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "u-c", email_confirmed_at: "2026-01-01T00:00:00Z" }, profile: { avatar_url: null, full_name: "Test Person" }, isLoading: false, isAdmin: false }),
}));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: () => {}, gate: (_k: string, f: () => void) => f, gatedProps: () => ({}) }) }));
vi.mock("@/lib/routePrefetch", () => ({ whenPageSettled: () => () => {}, prefetchRoute: () => {}, prefetchRoutesWhenIdle: () => () => {} }));

import { AppTopBar } from "@/components/sections/AppTopBar";
import { COMPACT_TOP_ROW } from "@/components/sections/browseHeaderSpacing";

const code = (rel: string) => blankComments(readFileSync(resolve(__dirname, "../..", rel), "utf8"));

afterEach(cleanup);

describe("the compact top (owner 11-14)", () => {
  it.each(["Jobs", "Declutter", "Messages"])("%s: no visible title row; the search, the bell and the photo share ONE row; the h1 stays for readers", (title) => {
    render(<MemoryRouter><AppTopBar title={title} search={<input aria-label={`Search ${title}`} />} /></MemoryRouter>);
    const bar = screen.getByTestId("app-top-bar");
    const h1 = screen.getByRole("heading", { level: 1, name: title });
    expect(h1.className.split(/\s+/)).toContain("sr-only");
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    // The search, the bell and the photo are all inside the one header row.
    expect(bar.contains(screen.getByRole("textbox", { name: `Search ${title}` }))).toBe(true);
    expect(bar.querySelector('[data-testid="top-bar-bell"]')).not.toBeNull();
    expect(bar.querySelector('[data-testid="top-bar-profile"]')).not.toBeNull();
    // Search first (flex-1), then the bell, then the photo.
    const kids = [...bar.children].filter((c) => !c.classList.contains("sr-only"));
    expect(kids[0].getAttribute("data-testid")).toBe("app-top-bar-search");
    expect(kids[0].className.split(/\s+/)).toContain("flex-1");
    expect(bar.className).toBe(COMPACT_TOP_ROW);
  });

  it("Home (no title): the search row with the bell and the photo, and no logo row", () => {
    render(<MemoryRouter><AppTopBar search={<input aria-label="Search jobs and items" />} /></MemoryRouter>);
    const bar = screen.getByTestId("app-top-bar");
    expect(bar.contains(screen.getByRole("textbox", { name: "Search jobs and items" }))).toBe(true);
    expect(bar.querySelector('a[href="/home"]')).toBeNull();
  });

  it("You (no search) keeps its visible title row with the bell", () => {
    render(<MemoryRouter><AppTopBar title="You" showProfile={false} /></MemoryRouter>);
    const h1 = screen.getByRole("heading", { level: 1, name: "You" });
    expect(h1.className.split(/\s+/)).not.toContain("sr-only");
    expect(screen.getByTestId("app-top-bar").querySelector('[data-testid="top-bar-bell"]')).not.toBeNull();
  });

  it("the row starts 8px under the safe area and adds no fixed height over its 44px controls", () => {
    expect(COMPACT_TOP_ROW.split(/\s+/)).toContain("pt-2");
    expect(COMPACT_TOP_ROW).not.toMatch(/\bh-\d/);
  });

  it("Messages hands its search to the bar, and every hand-drawn loading frame draws the same row", () => {
    expect(code("src/components/messages/ConversationList.tsx")).toContain("<AppTopBar title={t(\"msg.title\")} desktopGap={false} search={phoneSearchRow} />");
    const frames = ["src/components/JobsSectionSkeleton.tsx", "src/components/DashboardRouteSkeleton.tsx", "src/components/MessagesRouteSkeleton.tsx"];
    expect(frames.length).toBeGreaterThan(2); // vacuity floor
    for (const f of frames) {
      expect(code(f), f).toMatch(/className=\{COMPACT_TOP_ROW\}/);
      expect(code(f), f).not.toMatch(/app-top-bar flex items-center justify-between gap-2 h-16/);
    }
  });
});
