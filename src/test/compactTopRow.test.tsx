/**
 * THE COMPACT TOP (owner 11-14, after Depop's and Vinted's iPhone screens: "I think we need to make our top part more
 * like theirs so we can have more space"). On a phone, a main tab page with a search (Jobs, Declutter, Messages, Home)
 * draws ONE row, 8px under the safe area, with the bell and the photo inline on its right. Since owner 11-21 ("just the
 * icon" for search) the search is a magnifier, so the row shows the page's name again (the logo on Home, which has no
 * title); an OPENED search field (`data-search-open`) takes the row and the name steps back to a reader-only h1. A page
 * with no search (You) keeps its plain visible title.
 * Every loading frame that hand-draws the row (Jobs, Home) reads the same COMPACT_TOP_ROW. Since 11-15 the Inbox
 * (/messages, both tabs) is titled "Inbox" with its search under its tabs, as the owner chose; outside the Inbox the list
 * still hands its search to the bar.
 *
 * @mutate src/components/sections/AppTopBar.tsx | <h1 data-top-bar-title="" className="min-w-0 flex-1 truncate text-page-title text-foreground group-has-[[data-search-open]]/top:!sr-only" | <h1 data-top-bar-title="" className="sr-only"
 * @mutate src/components/sections/AppTopBar.tsx |         search ? ( |         false ? (
 * @mutate src/components/sections/browseHeaderSpacing.ts | export const COMPACT_TOP_ROW = "app-top-bar flex items-center gap-1 pt-2 pb-0.5"; | export const COMPACT_TOP_ROW = "app-top-bar flex items-center gap-1 pt-4 pb-0.5";
 * @mutate src/components/messages/ConversationList.tsx | <AppTopBar title={listTitle} desktopGap={false} search={isWebDesktop \|\| inInbox ? undefined : phoneSearchRow} /> | <AppTopBar title={listTitle} desktopGap={false} />
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
  it.each(["Jobs", "Declutter", "Messages"])("%s: ONE row: the visible title (until the search opens), the search icon, the Inbox icon and the photo; one h1", async (title) => {
    render(<MemoryRouter><AppTopBar title={title} search={<button type="button" data-search-icon="" aria-label={`Search ${title}`} />} /></MemoryRouter>);
    const bar = screen.getByTestId("app-top-bar");
    const h1 = screen.getByRole("heading", { level: 1, name: title });
    const h1Classes = h1.className.split(/\s+/);
    // Visible beside the icon; only an opened field (data-search-open in this row) makes it reader-only.
    expect(h1Classes).not.toContain("sr-only");
    expect(h1Classes).toContain("group-has-[[data-search-open]]/top:!sr-only");
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    // The search, the Inbox icon (owner 11-15) and the photo are all inside the one header row.
    expect(bar.contains(screen.getByRole("button", { name: `Search ${title}` }))).toBe(true);
    expect(bar.contains(await screen.findByTestId("top-bar-inbox"))).toBe(true);
    expect(bar.querySelector('[data-testid="top-bar-profile"]')).not.toBeNull();
    // The title first (flex-1), then the search (it grows only when opened), then the bell and the photo.
    const kids = [...bar.children];
    expect(kids[0]).toBe(h1);
    expect(h1Classes).toContain("flex-1");
    expect(kids[1].getAttribute("data-testid")).toBe("app-top-bar-search");
    expect(kids[1].className.split(/\s+/)).not.toContain("flex-1");
    expect(kids[1].className.split(/\s+/)).toContain("has-[[data-search-open]]:flex-1");
    expect(bar.className).toBe(`${COMPACT_TOP_ROW} group/top`);
  });

  it("Home (no title): the logo (flex-1), then the search icon, the bell and the photo in ONE row; the logo steps aside for an opened field", () => {
    render(<MemoryRouter><AppTopBar search={<button type="button" data-search-icon="" aria-label="Search jobs and items" />} /></MemoryRouter>);
    const bar = screen.getByTestId("app-top-bar");
    expect(bar.contains(screen.getByRole("button", { name: "Search jobs and items" }))).toBe(true);
    const logo = bar.querySelector('a[href="/home"]');
    expect(logo).not.toBeNull();
    const logoBox = bar.children[0];
    expect(logoBox.contains(logo)).toBe(true);
    expect(logoBox.className.split(/\s+/)).toEqual(expect.arrayContaining(["flex-1", "group-has-[[data-search-open]]/top:hidden"]));
    expect(bar.children[1].getAttribute("data-testid")).toBe("app-top-bar-search");
    expect(document.querySelectorAll("h1")).toHaveLength(0);
  });

  it("You (no search) keeps its visible title row with the Inbox icon", async () => {
    render(<MemoryRouter><AppTopBar title="You" showProfile={false} /></MemoryRouter>);
    const h1 = screen.getByRole("heading", { level: 1, name: "You" });
    expect(h1.className.split(/\s+/)).not.toContain("sr-only");
    expect(screen.getByTestId("app-top-bar").contains(await screen.findByTestId("top-bar-inbox"))).toBe(true);
  });

  it("the row starts 8px under the safe area and adds no fixed height over its 44px controls", () => {
    expect(COMPACT_TOP_ROW.split(/\s+/)).toContain("pt-2");
    expect(COMPACT_TOP_ROW).not.toMatch(/\bh-\d/);
  });

  it("Messages hands its search to the bar, and every hand-drawn loading frame draws the same row", () => {
    const list = code("src/components/messages/ConversationList.tsx");
    expect(list).toContain("<AppTopBar title={listTitle} desktopGap={false} search={isWebDesktop || inInbox ? undefined : phoneSearchRow} />");
    // Beside Messages, the bell and the photo (owner 11-14) the words shorten to "Search" below 460px, never cut mid-word.
    expect(code("src/components/messages/MessagesSearchRow.tsx")).toContain('{t("chat.searchShort")}<span className="max-[459px]:hidden"> {t("chat.searchNoun")}</span>');
    // The desktop two-pane list keeps its search as a row of its own (its title sits in the desktop bar).
    expect(list).toContain("{isWebDesktop && !inInbox && phoneSearchRow}");
    // Messages left this list on 11-15: the Inbox wears a visible "Inbox" title row with the search under its tabs
    // (its frame: src/test/inboxOneIconTwoTabs.test.tsx).
    const frames = ["src/components/JobsSectionSkeleton.tsx", "src/components/DashboardRouteSkeleton.tsx"];
    expect(frames.length).toBeGreaterThan(1); // vacuity floor
    for (const f of frames) {
      expect(code(f), f).toMatch(/className=\{COMPACT_TOP_ROW\}/);
      expect(code(f), f).not.toMatch(/app-top-bar flex items-center justify-between gap-2 h-16/);
    }
  });
});
