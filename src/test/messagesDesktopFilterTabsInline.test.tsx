/**
 * OWNER, 2026-09-19 (desktop screenshot of /messages): "in the top bar it
 * should say all un read and active. that should not be a drop down. this is
 * for desktop. on phone it will still need to drop down but the top will say
 * messages".
 *
 * OWNER, LATER THE SAME DAY — TWO CHANGES, and this file now asserts BOTH:
 *   1. The Unread tab is gone (confirmed twice). Two tabs, Active then All.
 *   2. The DISCLOSURE IS GONE TOO, at every width. The phone no longer drops
 *      the filter down behind a chevron; it renders the SAME inline strip the
 *      desktop website does, in the same header row, beside the same screen
 *      name. The phone TITLE CARD stays — that is a separate thing the owner
 *      asked for explicitly, and the <h1> assertions below hold it in place.
 *
 * THE CLASS, not the instance: ONE control must have ONE placement. The
 * original bug was that the inline strip was gated on `embedded`, a prop no
 * production caller passes, so the desktop branch never rendered. The fix
 * keyed both halves on `useIsWebDesktop()` — correct, but it left a real
 * two-layout split behind: inline at >=900px, behind a chevron below it. This
 * file now forbids BOTH failure modes at once, by asserting the identical
 * thing at both widths.
 *
 * WHAT CHANGED IN THIS FILE, precisely:
 *   - The old "phone / native: the tabs stay behind the disclosure" case is
 *     inverted, not deleted: phone must now show the tabs INLINE and must
 *     have NO disclosure button in either of its two labels.
 *   - The "tabs sit INSIDE the header row" case runs at BOTH widths instead
 *     of desktop only.
 *   - EXPECTED_TABS is unchanged and still EXACT — the full set, in order. An
 *     accidental third tab, a rename or a reorder still fails here. It is NOT
 *     weakened to "tabs exist somewhere": every assertion names the set, the
 *     order, and the container the strip must live in.
 *   - `disclosure()` is kept (not removed) so the absence is asserted by the
 *     same query that used to assert the presence.
 *
 * WHY THE TABS FIT THE PHONE ROW NOW AND DID NOT BEFORE — measured on the
 * production build at three widths, poster account, 6 threads:
 *      320: row 240px wide — tabs 104, controls 92, title 88 in the 132 left.
 *      375: row 295px wide — tabs 104, controls 92, title 88 in the 187 left.
 *     1440: unchanged from 9b0eb1fc8.
 *   Zero truncation of the <h1> at either width, `scrollWidth <= clientWidth`
 *   on <html> at both. Two tabs instead of three and two icon buttons instead
 *   of three is what bought the room; see ConversationList's placement note.
 *
 * @mutate src/components/messages/ConversationList.tsx | const headerMeta = hasThreads ? inboxTabs : undefined; | const headerMeta = undefined;
 * @mutate src/components/messages/ConversationList.tsx | const headerMeta = hasThreads ? inboxTabs : undefined; | const headerMeta = isWebDesktop && hasThreads ? inboxTabs : undefined;
 * @mutate src/components/messages/ConversationList.tsx | { key: "active", label: "Active", count: activeThreads }, | { key: "active", label: "Unread", count: activeThreads },
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(), hapticHeavy: vi.fn(),
}));

import { ConversationList } from "@/components/messages/ConversationList";
import type { Conversation } from "@/components/messages/types";

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

/**
 * The three filter tabs, read through UnderlineTabs' own accessible
 * container (`role="group"` + `aria-label="Filter conversations"`) rather
 * than by class or by any button that happens to say "All".
 */
function tabGroup() {
  return screen.queryByRole("group", { name: "Filter conversations" });
}
function filterTabs() {
  const group = tabGroup();
  if (!group) return [];
  return within(group)
    .getAllByRole("button")
    .map((t) => (t.textContent ?? "").replace(/\d+/g, "").trim());
}

/** The phone disclosure, in EITHER state (its label flips when open). */
function disclosure() {
  return (
    screen.queryByRole("button", { name: "Filter conversations" }) ??
    screen.queryByRole("button", { name: "Hide conversation filters" })
  );
}

afterEach(() => {
  cleanup();
  setWebDesktop(false);
});

/**
 * The exact set, in the exact order. Active then All: narrow to wide, and the
 * tab the inbox lands on comes first ("here, or everything", rather than the
 * old strip's "All, and some filters"). Unread went because it was redundant
 * three times over — Active is the default so the landing view is already
 * filtered to live conversations; unread is marked on the ROW (the dot + bold
 * preview in ConversationRow); and the list already scrolls to the first
 * unread thread on entry (028fe3837).
 */
const EXPECTED_TABS = ["Active", "All"];

/** The two widths the strip must be IDENTICAL at. */
const WIDTHS: Array<[label: string, webDesktop: boolean]> = [
  ["desktop website (>=900px)", true],
  ["phone / native", false],
];

describe("Messages inbox filter tabs — ONE inline placement at every width", () => {
  it("the inventory is real: this fixture produces a non-empty inbox", () => {
    // Every assertion below is gated on `hasThreads`. An empty fixture would
    // render no tabs and no chevron at EITHER width, and would pass both
    // "no disclosure" halves vacuously.
    setWebDesktop(false);
    renderInbox();
    expect(THREADS.length).toBeGreaterThan(1);
    expect(screen.getByRole("heading", { level: 1, name: "Messages" })).toBeTruthy();
  });

  for (const [label, webDesktop] of WIDTHS) {
    it(`${label}: Active / All are visible in the top bar, with no disclosure`, () => {
      setWebDesktop(webDesktop);
      renderInbox();

      expect(filterTabs()).toEqual(EXPECTED_TABS);
      expect(
        disclosure(),
        "no width may hide two visible words behind a chevron — one control, one placement",
      ).toBeNull();
    });

    it(`${label}: the tabs sit INSIDE the header row, beside the screen name`, () => {
      setWebDesktop(webDesktop);
      const { container } = renderInbox();

      // The row is the shared ScreenHeaderRow — identified by the one <h1> it
      // owns, not by a class, so this keeps holding if the styling moves.
      const h1 = screen.getByRole("heading", { level: 1, name: "Messages" });
      const row = h1.closest("div.flex.items-center");
      expect(row, "the screen name should live in the shared header row").not.toBeNull();

      const group = tabGroup();
      expect(group).not.toBeNull();
      expect(
        row!.contains(group!),
        "the filter tabs must be in the top bar itself, not on a second line below it",
      ).toBe(true);
      // And they are the header row's `meta` slot, not a stray match elsewhere
      // in the page: exactly one strip exists, at either width.
      expect(container.querySelectorAll('[role="group"][aria-label="Filter conversations"]')).toHaveLength(1);
    });
  }

  /**
   * The half of the owner's ask that did NOT change: the phone keeps its
   * visible "Messages" title card, and the desktop website keeps that name
   * sr-only (the app bar and side rail already say where you are). Asserted
   * here so "make the tabs inline everywhere" cannot be satisfied by also
   * making the two title treatments identical.
   */
  it("the phone keeps its VISIBLE screen name; the desktop website keeps it sr-only", () => {
    setWebDesktop(false);
    renderInbox();
    expect(
      screen.getByRole("heading", { level: 1, name: "Messages" }).className.includes("sr-only"),
      "phone has no app bar, so the title card is the only thing naming the screen",
    ).toBe(false);

    cleanup();
    setWebDesktop(true);
    renderInbox();
    expect(
      screen.getByRole("heading", { level: 1, name: "Messages" }).className.includes("sr-only"),
      "the desktop website's app bar and side rail already name the screen",
    ).toBe(true);
  });
});
