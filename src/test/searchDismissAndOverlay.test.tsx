/**
 * THE CLASS: an expanding search must never take another element's place, and
 * one activation of its dismiss must put the screen back exactly where it was.
 *
 * OWNER, 2026-09-19, two reports, one rule:
 *   (1) "search bars should also never open and cover anything anywhere. the
 *        search bar on home opens on the left right on top of the number of
 *        jobs. thats wrong. it needs to open where it was clicked, open
 *        slightly to the left of the icon so it doesn't cover anything"
 *   (2) "on post, the x on search needed to be clicked 3 times to close the
 *        search bar"
 *
 * WHAT THIS FILE CAN SEE, AND WHAT IT CANNOT — stated plainly, because the
 * difference decides what the browser pass still owes.
 *
 *   jsdom HAS NO LAYOUT. `getBoundingClientRect()` returns zeros for every
 *   element here, so this file cannot assert that two boxes do not intersect.
 *   It asserts the MECHANISM that produces (or forbids) an overlap:
 *     - no search field is positioned `absolute`/`fixed` inside its header
 *       row, which is the only way an in-flow row can paint one child over
 *       another;
 *     - the content that sits beside the trigger is still MOUNTED while the
 *       field is open, which is what makes "grows leftward into free space"
 *       different from "takes the count's place";
 *     - the dismiss contract, which needs no geometry at all.
 *
 *   THE BROWSER PASS MUST STILL CONFIRM, at 320 / 375 / 1440:
 *     a. the open field's rect does not intersect the rect of any sibling in
 *        its row (the real form of the rule);
 *     b. `documentElement.scrollWidth <= clientWidth` on /dashboard,
 *        /my-posts, /my-jobs, /messages, /legal and Profile ▸ Saved Helprs
 *        with search OPEN — an expanding field is a width change;
 *     c. the ✕'s rect and the search trigger's post-close rect DO NOT
 *        OVERLAP. This is the diagnosis for report (2) — see the block above
 *        `dashboardDesktopStrip` below — and it is the one thing only a
 *        browser can settle.
 *
 * THE INVENTORY IS DERIVED FROM SOURCE, not from a list this file also owns:
 * every `.tsx` under src/ carrying a search-open flag is found by reading the
 * tree, and the reviewed set below must equal it EXACTLY — a new expanding
 * search fails here until someone reviews it, and a deleted one fails too.
 *
 * @mutate src/components/job-card/ActivityHeader.tsx | if (wasOpenRef.current && !searchOpen) searchTriggerRef.current?.focus(); | if (false) searchTriggerRef.current?.focus();
 * @mutate src/components/job-card/ActivityHeader.tsx | if (e.key === "Escape") { e.preventDefault(); closeSearch(); } | if (e.key === "EscapeNope") { e.preventDefault(); closeSearch(); }
 * @mutate src/components/messages/ConversationList.tsx | if (wasSearchOpenRef.current && !searchOpen) searchTriggerRef.current?.focus(); | if (false) searchTriggerRef.current?.focus();
 * @mutate src/components/profile/SavedHelpersTab.tsx | searchTriggerRef.current?.focus(); | void 0;
 * @mutate src/components/dashboard/DashboardTitleBar.tsx | ?.querySelector<HTMLElement>("[data-search-trigger]") | ?.querySelector<HTMLElement>("[data-no-such-trigger]")
 * @mutate src/components/dashboard/browseTasksToolbar/BrowseTasksActions.tsx | data-search-trigger | data-search-trigger-renamed
 * @mutate src/components/ui/ScreenHeaderRow.tsx | data-search-trigger-slot | data-search-trigger-slot-renamed
 * @mutate src/components/ui/ScreenHeaderRow.tsx | className="shrink-0 pointer-events-none" | className="shrink-0"
 * @mutate src/components/job-card/ActivityHeader.tsx | triggerWidth: inlineFilters ? "28px" : "44px", | 
 * @mutate src/components/messages/ConversationList.tsx | triggerWidth: "44px", | 
 * @mutate src/components/profile/SavedHelpersTab.tsx | <SearchTriggerSlot /> | <span />
 * NO @mutate FOR pages/info/Legal.tsx. There was one — deleting the page's
 * `{searchOpen && <SearchTriggerSlot width="40px" />}` — and it had always
 * SURVIVED, because this file lists `pages/info/Legal.tsx` under NOT_EXERCISED with
 * a written reason. The registration claimed coverage the same file explicitly
 * disclaims two hundred lines below. It went unnoticed because vacuity only
 * mutates registrations whose target changed since origin/main, and nothing had
 * touched Legal.tsx since it was added; it surfaced the first time that page was
 * edited (2026-09-20). A registration that cannot fail is worse than none: it
 * reports coverage that does not exist. /legal's slot is carried by the browser
 * pass — see NOT_EXERCISED below.
 * @mutate src/pages/home/Dashboard.tsx | className="ml-auto" | className=""
 * @mutate src/pages/home/Dashboard.tsx | data-feed-strip | data-feed-strip-renamed
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
// No network (Q55a): ConversationList's mount-time pin/archive loads read
// thread_pins / thread_archives from Supabase. See the helper.
vi.mock("@/lib/pinnedConversations", async (io) =>
  (await import("@/test/helpers/threadStoresOffline")).pinnedConversationsOffline(io));
vi.mock("@/lib/archivedConversations", async (io) =>
  (await import("@/test/helpers/threadStoresOffline")).archivedConversationsOffline(io));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "user-1" }, loading: false }),
}));
/* Only the DATA is stubbed. `search` / `setSearch` stay real React state, so
   "one activation clears the query" is measured on the component's own
   transitions rather than on a spy. */
vi.mock("@/components/profile/savedHelpersTab/useSavedHelpers", async () => {
  const { useState } = await import("react");
  const helper = {
    helper_id: "h1", full_name: "Perry P.", avatar_url: null, bio: null,
    parish: "Orleans", skills: "cleaning", saved_at: new Date().toISOString(),
    completed_jobs_together: 2, last_job_at: null, avg_rating: 5, private_note: null,
  };
  return {
    useSavedHelpers: () => {
      const [search, setSearch] = useState("");
      return {
        helpers: [helper], loading: false, loadError: false, retrying: false,
        wasOffline: false, search, setSearch, sortBy: "recent", setSortBy: () => {},
        categoryFilter: null, setCategoryFilter: () => {}, editingNoteFor: null,
        noteDraft: "", setNoteDraft: () => {}, savingNote: false,
        loadSavedHelpers: () => {}, openNoteEditor: () => {}, cancelNoteEditor: () => {},
        saveNote: () => {}, handleRemove: () => {},
        filtered: search ? [] : [helper], activeSortLabel: "Recent activity",
      };
    },
  };
});
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(), hapticHeavy: vi.fn(),
}));

import { ActivityHeader } from "@/components/job-card/ActivityHeader";
import { ConversationList } from "@/components/messages/ConversationList";
import type { Conversation } from "@/components/messages/types";
import { blankComments } from "./helpers/blankNonCode";

const SRC = path.resolve(__dirname, "..");

/** Comments are not behaviour. Every source read below goes through this. */
function stripComments(src: string): string {
  // Was two deleting regexes; the `[^:]` was a partial patch for `https://`
  // eating its line, applied to only one of the two ways this goes wrong. The
  // block-comment half had the same string-blindness and no patch at all.
  // blankComments is string-aware and blanks in place. (2026-09-21)
  return blankComments(src);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "test") continue;
      walk(full, out);
    } else if (full.endsWith(".tsx") && !full.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * THE WORLD, read fresh: a `.tsx` that carries a search-open flag is a screen
 * whose search EXPANDS — the field exists only while that flag is true. That
 * is the whole class. Nothing here consults the reviewed list, so the two can
 * be diffed against each other in both directions.
 */
function deriveExpandingSearchFiles(): string[] {
  return walk(SRC)
    .filter((f) => /[Ss]earch[A-Za-z]*Open|\bsearchBar\b/.test(stripComments(readFileSync(f, "utf8"))))
    .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
    .sort();
}

/**
 * Reviewed, 2026-09-19. Every entry was read and classified:
 *
 *   components/dashboard/DashboardTitleBar.tsx        phone/native Browse row
 *   components/dashboard/BrowseTasksToolbar.tsx       owns the shared flag
 *   components/dashboard/browseTasksToolbar/
 *     BrowseSearchBar.tsx                             the Browse field
 *     BrowseTasksActions.tsx                          the Browse trigger
 *   components/messages/ConversationList.tsx          Messages inbox
 *   components/profile/SavedHelpersTab.tsx            Profile ▸ Saved Helprs
 *   components/job-card/JobListPage.tsx                                owns My Posts / My Jobs state
 *   pages/home/Dashboard.tsx                               desktop Browse strip — OPEN, see below
 *   pages/info/Legal.tsx                                   policy search
 *   components/job-card/ActivityHeader.tsx                 My Posts / My Jobs field
 *
 * The admin tables (AdminUsers, AdminSubscriptions, AdminReferrals,
 * AdminNotificationLogs, AdminSettings) are deliberately absent: their fields
 * are PERMANENT, never expand, and therefore cannot displace anything. The
 * admin ⌘K palette is a modal dialog with a scrim — an overlay by design, and
 * not a bar opening inside a row.
 */
const REVIEWED_EXPANDING_SEARCHES = [
  "components/dashboard/BrowseTasksToolbar.tsx",
  "components/dashboard/DashboardTitleBar.tsx",
  "components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx",
  "components/dashboard/browseTasksToolbar/BrowseTasksActions.tsx",
  "components/messages/ConversationList.tsx",
  "components/profile/SavedHelpersTab.tsx",
  "components/job-card/JobListPage.tsx",
  "pages/home/Dashboard.tsx",
  "pages/info/Legal.tsx",
  "components/job-card/ActivityHeader.tsx",
].sort();

// The exact gate useIsWebDesktop reads (min-width: 900px, non-native).
function setWebDesktop(on: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: on && /min-width:\s*900px/.test(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  cleanup();
  setWebDesktop(false);
});

/* ───────────────────────── inventory ───────────────────────── */

describe("the inventory of expanding searches is derived, not declared", () => {
  it("finds a NON-EMPTY set by reading src/, and it matches the reviewed set exactly", () => {
    const derived = deriveExpandingSearchFiles();
    // The floor. A broken walker, a renamed flag or a bad glob would otherwise
    // make every assertion below pass over nothing at all.
    expect(derived.length).toBeGreaterThanOrEqual(8);
    expect(derived).toEqual(REVIEWED_EXPANDING_SEARCHES);
  });

  it("the derivation can fail: a file with no search-open flag is not in it", () => {
    const derived = deriveExpandingSearchFiles();
    expect(derived).not.toContain("components/ui/ScreenHeaderRow.tsx");
    expect(derived).not.toContain("components/admin/AdminUsers.tsx");
  });
});

/* ──────────────── the mechanism: no field over a sibling ──────────────── */

/**
 * The header row itself. ScreenHeaderRow's inline-search branch renders the
 * page's `<h1>` and the search content as SIBLINGS, so the heading's parent is
 * the row — which keeps this out of class-name matching and off the page
 * shell (AppShell's frame is legitimately `fixed`, and walking to <body>
 * caught that instead of the row).
 */
function headerRow(): HTMLElement {
  const h1 = document.querySelector("h1");
  expect(h1, "the row must still carry the screen's single h1 while searching").toBeTruthy();
  return (h1 as HTMLElement).parentElement as HTMLElement;
}

/**
 * The only way an in-flow header row can paint one child on top of another is
 * for a child to leave the flow. No search field may.
 *
 * jsdom applies no stylesheet here, so this reads the CLASS LIST rather than a
 * computed position — which is exactly the mechanism half, and why (a) above
 * is still owed by the browser.
 */
function assertFieldStaysInFlow(field: HTMLElement, stopAt: HTMLElement) {
  expect(
    stopAt.contains(field),
    "the open field must live INSIDE the header row it was launched from",
  ).toBe(true);
  let node: HTMLElement | null = field;
  const offenders: string[] = [];
  while (node && node !== stopAt) {
    const cls = node.className;
    if (typeof cls === "string" && /(^|\s)(absolute|fixed)(\s|$)/.test(cls)) {
      offenders.push(cls);
    }
    node = node.parentElement;
  }
  expect(
    offenders,
    "a search field taken out of flow inside its header row can only land ON something",
  ).toEqual([]);
}

/* ───────────────────────── My Posts / My Jobs ───────────────────────── */

/**
 * Activity.tsx's own wiring, minus the data: plain `useState` for the two
 * search values, exactly as the page holds them. Stubbing the setters would
 * make "one activation" untestable — the whole report is about how many
 * activations the real transitions take.
 */
function ActivityHarness({
  inlineFilters,
  seen,
}: {
  inlineFilters: boolean;
  seen: { query: string };
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  seen.query = searchQuery;
  return (
    <ActivityHeader
      title="My Posts"
      titleSrOnly={inlineFilters}
      inlineFilters={inlineFilters}
      activeStatusFilters={[
        { key: "needs_you", label: "Needs you" },
        { key: "active", label: "Active" },
      ] as never}
      activeCounts={{ needs_you: 1, active: 2 }}
      statusFilter="needs_you"
      setStatusFilter={vi.fn()}
      searchOpen={searchOpen}
      setSearchOpen={setSearchOpen}
      searchQuery={searchQuery}
      setSearchQuery={setSearchQuery}
    />
  );
}

describe.each([
  ["phone / native", false],
  ["desktop website (>=900px)", true],
])("My Posts search — %s", (_label, inlineFilters) => {
  function mount() {
    const seen = { query: "" };
    render(
      <MemoryRouter>
        <ActivityHarness inlineFilters={inlineFilters} seen={seen} />
      </MemoryRouter>,
    );
    return seen;
  }

  it("the inventory is real: the row offers a search trigger at this width", () => {
    mount();
    expect(screen.getByRole("button", { name: "Search jobs" })).toBeTruthy();
    expect(screen.queryByRole("searchbox", { name: "Search jobs" })).toBeNull();
  });

  it("the field opens IN FLOW — nothing is positioned over a sibling", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Search jobs" }));
    assertFieldStaysInFlow(
      screen.getByRole("searchbox", { name: "Search jobs" }),
      headerRow(),
    );
  });

  it("the screen KEEPS ITS NAME while search is open — the field takes free space, not the title's", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Search jobs" }));
    expect(screen.getByRole("heading", { level: 1, name: "My Posts" })).toBeTruthy();
    // The desktop row's name is already sr-only at rest, so only the phone
    // placement has a visible one to keep.
    if (!inlineFilters) {
      expect(screen.getByText("My Posts", { selector: "span" })).toBeTruthy();
    }
  });

  it("ONE press of the ✕ returns the pre-open state: closed, cleared, focus back on the trigger", () => {
    const seen = mount();
    fireEvent.click(screen.getByRole("button", { name: "Search jobs" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search jobs" }), {
      target: { value: "lawn" },
    });
    expect(seen.query).toBe("lawn");

    fireEvent.click(screen.getByRole("button", { name: "Close search" }));

    expect(screen.queryByRole("searchbox", { name: "Search jobs" }), "one press must close it").toBeNull();
    expect(seen.query, "one press must clear the query").toBe("");
    expect(
      document.activeElement,
      "one press must hand focus back to the magnifier — otherwise the caret lands on <body>",
    ).toBe(screen.getByRole("button", { name: "Search jobs" }));
  });

  it("Escape is the keyboard's ✕ — same single activation", () => {
    const seen = mount();
    fireEvent.click(screen.getByRole("button", { name: "Search jobs" }));
    const field = screen.getByRole("searchbox", { name: "Search jobs" });
    fireEvent.change(field, { target: { value: "lawn" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("searchbox", { name: "Search jobs" })).toBeNull();
    expect(seen.query).toBe("");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Search jobs" }));
  });
});

/* ───────────────────────── Messages inbox ───────────────────────── */

const THREADS: Conversation[] = [
  {
    otherUserId: "u2",
    otherUserName: "Perry P.",
    jobTitle: "Fix a leaking kitchen faucet",
    jobId: "job-1",
    viewerIsPoster: true,
    lastMessage: "On my way",
    lastAt: new Date().toISOString(),
    unread: 1,
  },
  {
    otherUserId: "u3",
    otherUserName: "Dana R.",
    jobTitle: "Mow the front lawn",
    jobId: "job-2",
    viewerIsPoster: false,
    lastMessage: "Thanks!",
    lastAt: new Date(Date.now() - 60_000).toISOString(),
    unread: 0,
  },
];

function renderInbox() {
  return render(
    <MemoryRouter>
      <ConversationList
        conversations={THREADS}
        loading={false}
        loadError={false}
        retryInbox={vi.fn()}
        userId="user-1"
        loadConversations={vi.fn(async () => {})}
        openConvo={vi.fn()}
        setDeleteConvoConfirm={vi.fn()}
        onBatchArchive={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe.each([
  ["phone / native", false],
  ["desktop website (>=900px)", true],
])("Messages inbox search — %s", (_label, webDesktop) => {
  it("the inventory is real: this fixture produces a searchable inbox", () => {
    setWebDesktop(webDesktop);
    renderInbox();
    expect(THREADS.length).toBeGreaterThan(1);
    expect(screen.getByRole("button", { name: "Search conversations" })).toBeTruthy();
  });

  it("the field opens IN FLOW — nothing is positioned over a sibling", () => {
    setWebDesktop(webDesktop);
    renderInbox();
    fireEvent.click(screen.getByRole("button", { name: "Search conversations" }));
    assertFieldStaysInFlow(
      screen.getByRole("searchbox", { name: "Search conversations" }),
      headerRow(),
    );
  });

  it("ONE press of the ✕ returns the pre-open state: closed, cleared, focus back on the trigger", () => {
    setWebDesktop(webDesktop);
    renderInbox();
    fireEvent.click(screen.getByRole("button", { name: "Search conversations" }));
    const field = screen.getByRole("searchbox", { name: "Search conversations" });
    fireEvent.change(field, { target: { value: "Perry" } });
    expect((field as HTMLInputElement).value).toBe("Perry");

    fireEvent.click(screen.getByRole("button", { name: "Close search" }));

    expect(screen.queryByRole("searchbox", { name: "Search conversations" })).toBeNull();
    const trigger = screen.getByRole("button", { name: "Search conversations" });
    expect(document.activeElement, "focus must come back to the magnifier").toBe(trigger);
    // Re-open: the query must be gone, not remembered from the dismissed pass.
    fireEvent.click(trigger);
    expect(
      (screen.getByRole("searchbox", { name: "Search conversations" }) as HTMLInputElement).value,
      "the dismiss must CLEAR, or the next open silently filters the inbox",
    ).toBe("");
  });

  it("Escape is the keyboard's ✕ — same single activation", () => {
    setWebDesktop(webDesktop);
    renderInbox();
    fireEvent.click(screen.getByRole("button", { name: "Search conversations" }));
    const field = screen.getByRole("searchbox", { name: "Search conversations" });
    fireEvent.change(field, { target: { value: "Perry" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("searchbox", { name: "Search conversations" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Search conversations" }));
  });
});

/* ─────────────── the Browse row hands focus back across the swap ─────────────── */

describe("Browse title row — the trigger unmounts while search is open", () => {
  it("focus is handed back to the marked trigger when the field goes away", async () => {
    const { DashboardTitleBar } = await import("@/components/dashboard/DashboardTitleBar");
    const actions = (
      <button type="button" data-search-trigger aria-label="Search jobs">
        s
      </button>
    );
    const view = render(
      <MemoryRouter>
        <DashboardTitleBar actions={actions} trailing={<span />} searchBar={<input aria-label="Search jobs" />} />
      </MemoryRouter>,
    );
    // While open the trigger genuinely is not in the document — that is the
    // fact this arm exists for.
    expect(screen.queryByRole("button", { name: "Search jobs" })).toBeNull();

    view.rerender(
      <MemoryRouter>
        <DashboardTitleBar actions={actions} trailing={<span />} />
      </MemoryRouter>,
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Search jobs" }));
  });

  it("the marker exists on the real Browse trigger, not just on this fixture", () => {
    const src = stripComments(
      readFileSync(path.join(SRC, "components/dashboard/browseTasksToolbar/BrowseTasksActions.tsx"), "utf8"),
    );
    // The exact attribute TOKEN. A loose /data-search-trigger/ also matches
    // `data-search-trigger-renamed`, which is precisely the rename this arm
    // exists to catch (it survived that mutation once).
    expect(src).toMatch(/data-search-trigger(?![\w-])/);
    expect(src).toMatch(/aria-label="Search jobs"/);
  });
});

/* ───────────────────────── Profile ▸ Saved Helprs ───────────────────────── */

describe("Saved Helprs search — one control, one place", () => {
  async function mount() {
    const { SavedHelpersTab } = await import("@/components/profile/SavedHelpersTab");
    render(
      <MemoryRouter>
        <SavedHelpersTab onBack={vi.fn()} />
      </MemoryRouter>,
    );
  }

  it("the inventory is real: the header offers the trigger", async () => {
    await mount();
    expect(screen.getByRole("button", { name: "Search saved Helprs" })).toBeTruthy();
    expect(screen.queryByRole("searchbox", { name: "Search saved Helprs" })).toBeNull();
  });

  it("the field opens IN FLOW — on its own row, never over the header", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Search saved Helprs" }));
    const field = screen.getByRole("searchbox", { name: "Search saved Helprs" });
    let node: HTMLElement | null = field;
    const offenders: string[] = [];
    for (let i = 0; node && i < 4; i++, node = node.parentElement) {
      const cls = node.className;
      if (typeof cls === "string" && /(^|\s)(absolute|fixed)(\s|$)/.test(cls)) offenders.push(cls);
    }
    expect(offenders).toEqual([]);
  });

  it("ONE press of the trigger closes it, clears the query, and keeps the focus", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Search saved Helprs" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search saved Helprs" }), {
      target: { value: "perry" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));

    expect(screen.queryByRole("searchbox", { name: "Search saved Helprs" })).toBeNull();
    const trigger = screen.getByRole("button", { name: "Search saved Helprs" });
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    expect(
      (screen.getByRole("searchbox", { name: "Search saved Helprs" }) as HTMLInputElement).value,
    ).toBe("");
  });

  it("Escape is the keyboard's dismiss — same single activation", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Search saved Helprs" }));
    const field = screen.getByRole("searchbox", { name: "Search saved Helprs" });
    fireEvent.change(field, { target: { value: "perry" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("searchbox", { name: "Search saved Helprs" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Search saved Helprs" }));
  });
});

/* ───────────────────────── coverage floor ───────────────────────── */

/**
 * Every derived surface is either EXERCISED above or carries a written reason
 * for why it is not. Without this the inventory could grow a new expanding
 * search that no assertion ever touches, and the file would still be green.
 */
const EXERCISED = [
  "components/dashboard/DashboardTitleBar.tsx",
  "components/messages/ConversationList.tsx",
  "components/profile/SavedHelpersTab.tsx",
  "components/job-card/ActivityHeader.tsx",
];
const NOT_EXERCISED: Record<string, string> = {
  "components/dashboard/BrowseTasksToolbar.tsx":
    "holds no field and no trigger — it only passes the shared flag through to the sheet",
  "components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx":
    "the field DashboardTitleBar swaps in; its dismiss is covered by the title-row hand-back above and by e2e/journeys/01-browse.spec.ts",
  "components/dashboard/browseTasksToolbar/BrowseTasksActions.tsx":
    "trigger only — asserted by source for the data-search-trigger marker above",
  "components/job-card/JobListPage.tsx":
    "owns the state ActivityHeader renders; the transitions are exercised through the header",
  "pages/home/Dashboard.tsx":
    "the desktop feed strip — pinned by its own describe block below, from source, because the page is 900 lines behind a dozen data hooks and the fact under test is structural",
  "pages/info/Legal.tsx":
    "document-scroll marketing page: the field replaces nothing. The old reason added 'the tab group holds its own width' — it did not, and that was the bug: at 320 the tabs and the field were both flex-1 at 107px, the three tab labels overlapped, and the field sat under the typable floor. Fixed 2026-09-20 by stepping the tab group aside below 500px while the field is open. The 320/375 the browser pass owed is now paid: e2e/prod-audit/expanding-search-geometry.spec.ts runs /legal at 320, 375 and 1440 against the shared MIN_TYPABLE_FIELD_PX, with no per-surface pin",
};

describe("coverage", () => {
  it("every derived expanding search is exercised or has a written reason", () => {
    const derived = deriveExpandingSearchFiles();
    expect(derived.length).toBeGreaterThan(0);
    const accounted = [...EXERCISED, ...Object.keys(NOT_EXERCISED)].sort();
    expect(accounted).toEqual(derived);
    // And the reasons are reasons, not empty strings.
    for (const [file, why] of Object.entries(NOT_EXERCISED)) {
      expect(why.length, `${file} needs a real reason`).toBeGreaterThan(20);
    }
  });
});

/* ─────────────── the desktop Browse strip: CLOSED, and pinned ─────────────── */

/**
 * THE ORIGINAL REPORT, now fixed — and this is what keeps it fixed.
 *
 * What the source used to say (Dashboard.tsx, the web-desktop feed strip):
 *
 *     {filters.searchOpen ? (
 *       <BrowseSearchBar filters={filters} floatRecents />
 *     ) : (
 *       <>  <span …>{totalMatchingCount} jobs…</span>  …actions… </>
 *     )}
 *
 * The count and the WHOLE trailing cluster lived only in the alternate. Open
 * search and all of it unmounted, and the field — `flex-1 min-w-0
 * lg:max-w-md`, the row's first child — started at the row's LEFT edge, which
 * is the count's place. That is the owner's "opens on the left right on top of
 * the number of jobs": to the reader there is no difference between a field
 * drawn over a label and a field that took its place. It is also why "open
 * slightly to the left of the icon" was not merely unimplemented but
 * impossible — the icon itself disappeared.
 *
 * Read from source rather than by rendering, deliberately: Dashboard is a
 * 900-line page behind a dozen data hooks, and the fact under test is
 * structural ("what does opening search unmount?"). The BEHAVIOUR at real
 * widths — that the field covers neither the count nor the cluster, and that
 * the ✕ clears the magnifier's landing box — is measured in a browser by
 * e2e/prod-audit/expanding-search-geometry.spec.ts, which is where geometry
 * belongs.
 */
describe("desktop Browse strip — opening search unmounts nothing but the field", () => {
  const dashboard = () => stripComments(readFileSync(path.join(SRC, "pages/home/Dashboard.tsx"), "utf8"));

  it("the feed strip is findable, so the assertions below are about something", () => {
    const src = dashboard();
    // `(?![-\w])` is load-bearing. A bare /data-feed-strip/ is a SUBSTRING
    // match, so renaming the attribute to `data-feed-strip-renamed` — i.e.
    // exactly the mutation this file registers for it on line 65 — still
    // matched, and this guard reported the strip "findable" when nothing could
    // find it. It SURVIVED its own mutation from the day it was written; it
    // only showed up on 2026-09-20 because vacuity mutates a registration when
    // its target changes, and nothing had touched the pair since.
    expect(src).toMatch(/data-feed-strip(?![-\w])/);
    expect(src, "the strip must still render the live jobs count").toMatch(/totalMatchingCount/);
  });

  it("no search ternary swaps the row out any more", () => {
    // The exact shape the defect had. Its absence IS the fix; a regression
    // would have to re-introduce a branch on the flag around the row.
    expect(
      dashboard(),
      "the desktop feed strip must not gate its contents on searchOpen — only the FIELD is conditional",
    ).not.toMatch(/\{\s*filters\.searchOpen\s*\?\s*\(/);
  });

  it("the count and the icon cluster are OUTSIDE everything searchOpen gates", () => {
    const src = dashboard();
    // Collect every `filters.searchOpen && (…)` region into ONE string, and
    // assert about that string rather than looping a local array: the region
    // is read out of Dashboard.tsx, so the SOURCE is the oracle here, but a
    // `for (const x of localArray)` shape reads to the vacuity scanner as a
    // list that is both input and oracle. One haystack, no loop.
    const needle = "filters.searchOpen && (";
    let guardedRegions = "";
    let regionCount = 0;
    for (let i = src.indexOf(needle); i !== -1; i = src.indexOf(needle, i + 1)) {
      let depth = 0;
      for (let j = i; j < src.length; j++) {
        if (src[j] === "(") depth++;
        else if (src[j] === ")") {
          depth--;
          if (depth === 0) { guardedRegions += src.slice(i, j); regionCount++; break; }
        }
      }
    }
    // Vacuity floor: if nothing is gated on the flag, this proves nothing.
    expect(
      regionCount,
      "no `filters.searchOpen && (` guard found — the strip no longer renders a conditional field, so this check is vacuous",
    ).toBeGreaterThan(0);
    expect(
      guardedRegions,
      "opening search must not unmount the jobs count — the field has to grow into free space beside it",
    ).not.toMatch(/totalMatchingCount/);
    expect(
      guardedRegions,
      "opening search must not unmount the filters / saved / map cluster",
    ).not.toMatch(/BrowseTasksActions/);
  });

  it("the open field is anchored RIGHT, so the slack lands in front of it", () => {
    // `ml-auto` is the difference between "grows leftward out of the cluster"
    // and "opens on the left on top of the count". Without it flexbox parks
    // the row's free space AFTER a capped field.
    expect(
      dashboard(),
      "the desktop strip's BrowseSearchBar must carry ml-auto",
    ).toMatch(/<BrowseSearchBar[^>]*className="ml-auto"/);
  });

  it("the strip hands focus back to the magnifier, like every other surface", () => {
    // Measured live at 1400 before this: the ✕ closed search in one click and
    // left `document.activeElement` on <body>.
    expect(dashboard()).toMatch(/desktopStripRef\.current[\s\S]{0,120}data-search-trigger/);
  });
});

/* ─────────────── the landing slot, on every surface that has one ─────────────── */

/**
 * THE THREE-CLICK FIX, as a source contract.
 *
 * Owner, 2026-09-19 (/my-posts): "the x on search needed to be clicked 3 times
 * to close the search bar". The ✕ is anchored to the open field's trailing
 * edge; dropping the magnifier from the right-aligned cluster while the field
 * is up lets the field grow into the space the magnifier will come back to, so
 * the ✕ ends up sitting ON the magnifier's box — measured 26px of overlap at
 * 375 on /my-posts, with the ✕'s visual centre inside it. One tap closes, the
 * magnifier appears under the finger, the next tap re-opens.
 *
 * The fix is `SearchTriggerSlot`: the row holds the magnifier's slot OPEN
 * while the field is up. jsdom cannot see the pixels — the overlap going from
 * N to 0 at 320/375/1440 is measured in
 * e2e/prod-audit/expanding-search-geometry.spec.ts, which also DELETES the
 * slot from the live DOM and fails unless the overlap comes straight back.
 * What this file pins is that every surface still HAS one, derived from the
 * inventory above rather than from a list written beside it.
 */

/**
 * The surfaces whose open state does NOT need to reserve the trigger's box,
 * and why. Everything else in the DERIVED inventory must — the list of
 * surfaces that DO is computed as "the world minus these", never written
 * down, so a new expanding search is asserted on the day it lands rather than
 * on the day someone remembers to add it here.
 */
const NO_SLOT_NEEDED: Record<string, string> = {
  "components/dashboard/BrowseTasksToolbar.tsx":
    "renders no row and no trigger — it only passes the shared flag to the filter sheet",
  "components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx":
    "the FIELD, not a row: it carries the magnifier inside its left edge and the ✕ inside its right. The slot belongs to whichever row renders it (BrowseTasksActions on desktop; the phone brand row unmounts its whole cluster instead, so nothing of it is near the ✕)",
  "components/dashboard/DashboardTitleBar.tsx":
    "the phone brand row gives the WHOLE bar to the field, so the entire cluster — magnifier included — is unmounted and none of it is adjacent to the ✕. Measured at 375: the magnifier returns third from the right, clear of the ✕ by 50px",
  "components/job-card/JobListPage.tsx":
    "owns the state ActivityHeader renders; it holds no row of its own",
  "pages/home/Dashboard.tsx":
    "renders the strip whose slot BrowseTasksActions supplies — pinned by the describe block above",
};

/** The world, minus the written exclusions. Input and oracle are different things. */
const MUST_RESERVE_THE_SLOT = deriveExpandingSearchFiles().filter((f) => !(f in NO_SLOT_NEEDED));

describe("every expanding search holds the magnifier's landing slot open", () => {
  it("the exclusions are real files, and something is left to assert", () => {
    const derived = deriveExpandingSearchFiles();
    for (const file of Object.keys(NO_SLOT_NEEDED)) {
      expect(derived, `${file} is excluded but is not in the inventory — stale exclusion`).toContain(file);
      expect(NO_SLOT_NEEDED[file].length, `${file} needs a real reason`).toBeGreaterThan(30);
    }
    // The floor. If the exclusions ever swallowed the whole inventory the
    // it.each below would iterate nothing and this file would still be green.
    expect(
      MUST_RESERVE_THE_SLOT.length,
      "every expanding search got excluded — the slot contract would be asserted about nothing",
    ).toBeGreaterThanOrEqual(4);
  });

  it.each(MUST_RESERVE_THE_SLOT)("%s renders a SearchTriggerSlot", (file) => {
    const src = stripComments(readFileSync(path.join(SRC, file), "utf8"));
    expect(
      src,
      `${file} opens a search field but never holds the magnifier's slot — the ✕ will land on the trigger`,
    ).toMatch(/<SearchTriggerSlot[\s/>]|triggerWidth:/);
  });

  it("the slot carries the marker the browser probe addresses it by", () => {
    const src = stripComments(readFileSync(path.join(SRC, "components/ui/ScreenHeaderRow.tsx"), "utf8"));
    // The exact attribute TOKEN, not a prefix — a loose match also accepts a
    // rename, which is the mutation this arm exists to catch.
    expect(src).toMatch(/data-search-trigger-slot(?![\w-])/);
    expect(src, "the slot must be inert: it is held-open space, never a control").toMatch(/pointer-events-none/);
    expect(src, "and invisible to assistive tech").toMatch(/aria-hidden/);
  });
});
