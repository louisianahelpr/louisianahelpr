/**
 * SEARCH IS JUST THE ICON (owner 11-21 ~9:20 PM, pop-up: page headers use "just the icon" for search, everywhere a wide
 * always-open box sat). Every page header's search starts as the shared magnifier (SearchIconButton: a plain 40px ghost
 * square, no circle, no border, 44px to the finger); a tap opens the field in place and focuses it; Escape or its X
 * clears it and folds it back into the icon (focus returns to the icon); it stays open, with the words visible, while
 * a query is active.
 *
 * The class: the shared header searches (SectionSearchBar: Jobs, Home, Homes, Declutter's phone bar; SectionSearchRow:
 * Shops, Homes Browse; MessagesSearchRow: Inbox; InlineListSearch: Jobs Posted/Working) and the pages with their own
 * (Help, Find a Helpr, Saved Helprs, the desktop Home). /search keeps its open field (it is the page's purpose); admin
 * screens are not page headers. Red on d6fcb5fe07 (every check below that renders a control found a field, not an icon).
 *
 * @mutate src/components/sections/SectionSearchBar.tsx | const open = props.onChange !== undefined && (opened \|\| hasWords); | const open = props.onChange !== undefined;
 * @mutate src/components/sections/SectionSearchBar.tsx | onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); close(); } }} | onKeyDown={() => undefined}
 * @mutate src/components/sections/SectionSearchBar.tsx | if (!e.currentTarget.value) setOpened(false); | setOpened(false);
 * @mutate src/components/sections/SectionSearchBar.tsx |       <SearchIconButton label={label} data-section-search-bar="" onClick={() => navigate(home, { state: FOCUS_SEARCH_STATE })} /> |       <button type="button" aria-label={label} data-section-search-bar="" onClick={() => navigate(home, { state: FOCUS_SEARCH_STATE })}>{label}</button>
 * @mutate src/components/sections/SectionSearchRow.tsx |   const open = pinned \|\| opened \|\| value.length > 0; |   const open = true;
 * @mutate src/components/sections/SectionSearchRow.tsx | onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); close(); } }} | onKeyDown={() => undefined}
 * @mutate src/components/messages/MessagesSearchRow.tsx |   const open = opened \|\| value.length > 0; |   const open = true;
 * @mutate src/components/messages/MessagesSearchRow.tsx | if (!e.currentTarget.value) setOpened(false); | setOpened(false);
 * @mutate src/pages/info/HelpCenter.tsx |   const searchShown = searchOpen \|\| query.length > 0; |   const searchShown = true;
 * @mutate src/pages/helprs/FindHelprs.tsx |   const townShown = townOpen \|\| !!town \|\| !!townDraft; |   const townShown = true;
 * @mutate src/components/sections/AppTopBar.tsx | group-has-[[data-search-open]]/top:!sr-only | sr-only
 * @mutate src/components/sections/AppTopBar.tsx | className="flex min-w-0 shrink-0 justify-end has-[[data-search-open]]:flex-1" | className="flex min-w-0 shrink-0 justify-end"
 * @mutate src/components/ui/SearchIconButton.tsx | "h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-ds-md btn-press | "h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-full border btn-press
 * @mutate src/pages/home/HomeDashboard.tsx | className={`${SEARCH_ICON_BUTTON_CLASS} min-h-11 min-w-11`} | className="w-[260px] rounded-full border"
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState, type ReactNode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => {} }));
vi.mock("@/components/help/HelpEntry", () => ({ HelpEntry: () => null }));
vi.mock("@/hooks/useOnboardingFee", async (orig) => ({ ...(await orig<typeof import("@/hooks/useOnboardingFee")>()), useOnboardingFeeCents: () => 200 }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false, useFeatureStatus: () => ({ on: false, settled: true }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false, explain: () => {}, gate: (_k: string, f: () => void) => f, gatedProps: () => ({}) }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async () => ({ data: [], error: null }),
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }), getSession: async () => ({ data: { session: null }, error: null }) },
  },
}));
// Each test picks a width: the phone (375) or the desktop website (1440).
const desktop = vi.hoisted(() => ({ on: false }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => desktop.on }));

import { SectionSearchBar } from "@/components/sections/SectionSearchBar";
import { SectionSearchRow } from "@/components/sections/SectionSearchRow";
import { MessagesSearchRow } from "@/components/messages/MessagesSearchRow";
import "@/lib/i18n/enScreens"; // the Inbox's words ("Search conversations"), as ConversationList's screen loads them
import { InlineListSearch } from "@/components/sections/InlineListSearch";
import { SEARCH_ICON_BUTTON_CLASS } from "@/components/ui/SearchIconButton";
import HelpCenter from "@/pages/info/HelpCenter";
import FindHelprs from "@/pages/helprs/FindHelprs";

afterEach(() => { cleanup(); desktop.on = false; });

const WIDTHS = [375, 1440] as const;
const setWidth = (w: number) => {
  desktop.on = w >= 1024;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
};
const wrap = (ui: ReactNode, url = "/") =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="*" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** The shared magnifier: the plain ghost square (no circle, no border), a glyph and no words. */
function expectIcon(el: HTMLElement | null, label: string) {
  expect(el, `${label}: the icon`).not.toBeNull();
  expect(el!.tagName).toBe("BUTTON");
  expect(el!.getAttribute("aria-label")).toBe(label);
  expect(el!.getAttribute("aria-expanded")).toBe("false");
  expect((el!.textContent ?? "").trim(), "no words").toBe("");
  expect(el!.querySelector("svg"), "a glyph").not.toBeNull();
  const cls = el!.className.split(/\s+/);
  expect(cls).toEqual(expect.arrayContaining(["h-10", "w-10", "rounded-ds-md", "text-muted-foreground"]));
  expect(cls.some((c) => /^(border|rounded-full|bg-card)$/.test(c)), "no circle, border or fill").toBe(false);
}

/** Open from the icon, prove the focus, keep it open with words through a blur, then Escape folds it back. */
async function exercise(container: HTMLElement, label: string, fieldName = label) {
  expect(container.querySelector('input[type="search"], input#helpr-town'), "no field before the tap").toBeNull();
  const icon = screen.getByRole("button", { name: label });
  expectIcon(icon, label);
  await act(async () => { fireEvent.click(icon); });
  const box = screen.getByRole("searchbox", { name: fieldName });
  expect(document.activeElement, "the field takes the focus").toBe(box);
  expect(screen.queryByRole("button", { name: label }), "the icon gave way to the field").toBeNull();
  // Leaving an empty field folds it.
  await act(async () => { fireEvent.blur(box); });
  expect(container.querySelector('input[type="search"], input#helpr-town'), "an empty field folds on leaving").toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: label })); });
  const again = screen.getByRole("searchbox", { name: fieldName });
  await act(async () => { fireEvent.change(again, { target: { value: "lawn" } }); });
  await act(async () => { fireEvent.blur(again); });
  const kept = screen.getByRole("searchbox", { name: fieldName }) as HTMLInputElement;
  expect(kept.value, "a query keeps it open and visible").toBe("lawn");
  await act(async () => { fireEvent.keyDown(kept, { key: "Escape" }); });
  expect(container.querySelector('input[type="search"], input#helpr-town'), "Escape folds it").toBeNull();
  expect(document.activeElement, "focus returns to the icon").toBe(screen.getByRole("button", { name: label }));
}

function Controlled({ render: r, initial = "" }: { render: (v: string, set: (v: string) => void) => ReactNode; initial?: string }) {
  const [v, setV] = useState(initial);
  return <>{r(v, setV)}</>;
}

describe("the shared header searches start as the icon at 375 and 1440", () => {
  for (const w of WIDTHS) {
    it(`${w}: SectionSearchBar (Jobs, Home, Homes): icon + Filters, opens focused, query keeps it, Escape folds it`, async () => {
      setWidth(w);
      const { container } = wrap(<Controlled render={(v, set) => <SectionSearchBar noun="jobs" home="/jobs" value={v} onChange={set} filter={<button type="button" aria-label="Filters" />} />} />);
      expect(screen.getByRole("button", { name: "Filters" }), "Filters stays beside the icon").toBeInTheDocument();
      await exercise(container, "Search jobs");
    });

    it(`${w}: SectionSearchRow (Shops, Homes Browse): icon + Filters, opens focused, query keeps it, Escape folds it`, async () => {
      setWidth(w);
      const { container } = wrap(<Controlled render={(v, set) => <SectionSearchRow value={v} onChange={set} placeholder="Search shops" onFilters={() => {}} />} />);
      expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
      await exercise(container, "Search shops");
    });

    it(`${w}: MessagesSearchRow (Inbox): icon + menu, opens focused, query keeps it, Escape folds it`, async () => {
      setWidth(w);
      const { container } = wrap(<Controlled render={(v, set) => <MessagesSearchRow value={v} onChange={set} moreMenu={<button type="button" aria-label="More" />} />} />);
      expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
      await exercise(container, "Search conversations");
    });

    it(`${w}: Help: the icon by the title opens "Search help"`, async () => {
      setWidth(w);
      Element.prototype.scrollIntoView = vi.fn();
      const { container } = wrap(<HelpCenter />, "/help");
      await exercise(container, "Search help");
    });

    it(`${w}: Find a Helpr: the icon by the title opens the town search`, async () => {
      setWidth(w);
      const { container } = wrap(<FindHelprs />, "/helprs");
      await exercise(container, "Find a Helpr by town", "Town or parish");
    });
  }

  it("words already in the field (?q=) open it on arrival, unfocused; the X clears and folds it", async () => {
    const changes: string[] = [];
    const { container } = wrap(<Controlled initial="lawn" render={(v, set) => <SectionSearchBar noun="jobs" home="/jobs" value={v} onChange={(x) => { changes.push(x); set(x); }} />} />);
    const box = screen.getByRole("searchbox", { name: "Search jobs" }) as HTMLInputElement;
    expect(box.value).toBe("lawn");
    expect(document.activeElement).not.toBe(box);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Close search" })); });
    expect(changes).toEqual([""]);
    expect(container.querySelector('input[type="search"]')).toBeNull();
    expectIcon(screen.getByRole("button", { name: "Search jobs" }), "Search jobs");
  });

  it("a link-mode bar (another tab, Home) is the icon; it opens the section's field there, focused", async () => {
    render(
      <MemoryRouter initialEntries={["/other"]}>
        <Routes>
          <Route path="/other" element={<SectionSearchBar noun="jobs" home="/jobs" />} />
          <Route path="/jobs" element={<Controlled render={(v, set) => <SectionSearchBar noun="jobs" home="/jobs" value={v} onChange={set} />} />} />
        </Routes>
      </MemoryRouter>,
    );
    const icon = screen.getByRole("button", { name: "Search jobs" });
    expectIcon(icon, "Search jobs");
    await act(async () => { fireEvent.click(icon); });
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Search jobs" }));
  });

  it("Jobs Posted / Working (InlineListSearch) wears the same shared magnifier", () => {
    wrap(<InlineListSearch value="" onChange={() => {}} label="Search posted jobs" />);
    expectIcon(screen.getByRole("button", { name: "Search posted jobs" }), "Search posted jobs");
  });

  it("Declutter's Manager panel keeps its always-open name filter (a panel list filter, not a page header)", () => {
    const { container } = wrap(<SectionSearchRow value="" onChange={() => {}} placeholder="Search by name" searchLabel="Member's name" pinned />);
    expect(within(container).getByRole("searchbox", { name: "Search by name" })).toBeInTheDocument();
  });
});

// The phone top bar: with the search folded, the row shows the page's name; an opened field takes the row and the name
// steps back to the screen reader (jsdom has no :has(), so the classes are read; the look is proven at 375 on a build).
const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", p), "utf8"));

describe("the phone top bar hands an opened search the row", () => {
  const bar = read("components/sections/AppTopBar.tsx");
  it("the title is visible until a field opens; the search box grows only then", () => {
    const row = bar.slice(bar.indexOf("search ? ("), bar.indexOf("{mineSheet}", bar.indexOf("search ? (")));
    expect(row.length).toBeGreaterThan(200);
    expect(row).toContain('className={`${COMPACT_TOP_ROW} group/top`}');
    expect(row).toMatch(/<h1 data-top-bar-title="" className="min-w-0 flex-1 truncate text-page-title text-foreground group-has-\[\[data-search-open\]\]\/top:!sr-only"/);
    expect(row).not.toMatch(/<h1 className="sr-only">/);
    expect(row).toContain('data-testid="app-top-bar-search" className="flex min-w-0 shrink-0 justify-end has-[[data-search-open]]:flex-1"');
  });

  it("every opened header field carries data-search-open (what the bar keys on)", () => {
    let n = 0;
    for (const f of ["components/sections/SectionSearchBar.tsx", "components/sections/SectionSearchRow.tsx", "components/messages/MessagesSearchRow.tsx"]) {
      expect(read(f), f).toContain('data-search-open=""');
      n++;
    }
    expect(n).toBe(3);
  });
});

describe("every listed page's search is the icon (inventory)", () => {
  // Page file -> the icon-first control it draws its header search with.
  const PAGES: Record<string, RegExp> = {
    "pages/jobs/JobsSection.tsx": /<SectionSearchBar noun="jobs" home="\/jobs" \/>/,
    "pages/home/Dashboard.tsx": /<SectionSearchBar noun="jobs" home="\/jobs" value=\{filters\.searchQuery\}/,
    "pages/home/HomeDashboard.tsx": /<SectionSearchBar noun=\{t\("home\.searchNoun"\)\} home="\/search" \/>/,
    "pages/home/DashboardGuest.tsx": /<SectionSearchBar noun="jobs" home="\/browse" value=\{filters\.searchQuery\}/,
    "components/shops/ShopsHomeView.tsx": /<SectionSearchRow\b/,
    "components/rentals/listings/RentBrowse.tsx": /<SectionSearchRow\b/,
    "components/rentals/RentalsHomeView.tsx": /<SectionSearchBar noun="homes" home="\/rentals" \/>/,
    "components/messages/ConversationList.tsx": /<MessagesSearchRow\b/,
    "pages/info/HelpCenter.tsx": /<SearchIconButton\b/,
    "pages/helprs/FindHelprs.tsx": /<SearchIconButton\b/,
    "components/profile/SavedHelpersTab.tsx": /<SearchIconButton\b/,
  };
  it("each draws the shared icon-first control", () => {
    let n = 0;
    for (const [file, rx] of Object.entries(PAGES)) {
      expect(read(file), file).toMatch(rx);
      n++;
    }
    expect(n).toBeGreaterThan(10);
  });

  it("the desktop Home's search is the shared magnifier linking to /search, not the 260px pill", () => {
    const home = read("pages/home/HomeDashboard.tsx");
    const at = home.indexOf('data-testid="home-desktop-search"');
    expect(at).toBeGreaterThan(-1);
    const tag = home.slice(home.lastIndexOf("<Link", at), home.indexOf(">", home.indexOf("className=", at)) + 1);
    expect(tag).toContain('to="/search"');
    expect(tag).toContain("className={`${SEARCH_ICON_BUTTON_CLASS} min-h-11 min-w-11`}");
    expect(home).not.toMatch(/DESKTOP_SEARCH_PILL_WIDTH/);
    expect(SEARCH_ICON_BUTTON_CLASS.split(/\s+/)).toEqual(expect.arrayContaining(["h-10", "w-10", "rounded-ds-md"]));
  });
});
