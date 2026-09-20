/**
 * OWNER, 2026-09-19 (desktop screenshot of /messages): "in the top bar it
 * should say all un read and active. that should not be a drop down. this is
 * for desktop. on phone it will still need to drop down but the top will say
 * messages".
 *
 * OWNER, LATER THE SAME DAY — TWO CHANGES, and this file now asserts BOTH:
 *   1. The Unread tab is gone (confirmed twice). Two tabs, Active then All.
 *   2. THE DISCLOSURE IS GONE, at every width. The phone no longer hides the
 *      filter behind a chevron; the strip is always on screen. The phone
 *      TITLE CARD stays — a separate thing the owner asked for explicitly,
 *      held in place by the <h1> assertions below.
 *
 * THE CLASS, not the instance: ONE control must have ONE STATE. The original
 * bug was that the inline strip was gated on `embedded`, a prop no production
 * caller passes, so the desktop branch never rendered. The fix keyed both
 * halves on `useIsWebDesktop()` — correct, but it left the phone's filter
 * behind a chevron the reader had to find. Now neither surface hides it.
 *
 * WHERE IT SITS IS STILL SPLIT, AND THAT SPLIT IS MEASURED, NOT CHOSEN.
 * Inline in the header row is only possible where the row has the width.
 * On the production build (`vite preview`, prod backend, poster-e2e, 31
 * threads), with the chevron already removed so the cluster is two buttons:
 *
 *                   row     actions  gaps  strip   left for "Messages"  needs
 *     320 (card 238px)  92      20    106            20            88   ✗ "M."
 *     375 (card 293px)  92      20    106            75            88   ✗ "Messa…"
 *     1440 (panel 1102) 92      20    106           884            78   ✓
 *
 * So the phone strip keeps its own line under the toolbar — the same split
 * ActivityHeader makes under `inlineFilters`. What this file forbids is the
 * DISCLOSURE, at either width, and it asserts the exact same tab set and
 * order at both.
 *
 * WHAT CHANGED IN THIS FILE, precisely:
 *   - The old "the tabs stay behind the disclosure … opens COLLAPSED" case is
 *     inverted, not deleted: phone must now render the tabs on first paint
 *     with no click, and must have NO disclosure button in either of its two
 *     accessible names.
 *   - The desktop "tabs sit INSIDE the header row" case is unchanged, and it
 *     gains its phone complement: on phone the strip exists but is NOT in the
 *     header row, which is what keeps the title from truncating.
 *   - EXPECTED_TABS is unchanged and still EXACT — the full set, in order. An
 *     accidental third tab, a rename or a reorder still fails here. It is NOT
 *     weakened to "tabs exist somewhere".
 *   - `disclosure()` is kept (not removed) so the absence is asserted by the
 *     same query that used to assert the presence.
 *
 * @mutate src/components/messages/ConversationList.tsx | {!isWebDesktop && hasThreads && !searchOpen && !selectMode && ( | {!isWebDesktop && hasThreads && false && !searchOpen && !selectMode && (
 * @mutate src/components/messages/ConversationList.tsx | const headerMeta = isWebDesktop && hasThreads ? inboxTabs : undefined; | const headerMeta = undefined;
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

describe("Messages inbox filter tabs — always visible, never behind a disclosure", () => {
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

      // On FIRST PAINT, with no click: the phone half of this used to require
      // `fireEvent.click(chevron)` to see anything at all.
      expect(filterTabs()).toEqual(EXPECTED_TABS);
      expect(
        disclosure(),
        "no width may hide two visible words behind a chevron — one control, one state",
      ).toBeNull();
    });

    it(`${label}: exactly ONE strip renders — never both placements, never neither`, () => {
      setWebDesktop(webDesktop);
      const { container } = renderInbox();
      expect(
        container.querySelectorAll('[role="group"][aria-label="Filter conversations"]'),
      ).toHaveLength(1);
    });
  }

  /**
   * The placement split, asserted as exact complements so it cannot be
   * satisfied by a component that renders the strip in both places or in
   * neither. Desktop: inside the shared header row (the row has 884px to
   * spare there). Phone: NOT in that row — the row has 20px at 320 against a
   * title needing 88, so putting it there is what truncated "Messages" to
   * "M.". See the measurement table at the top of this file.
   */
  it("desktop website: the strip is INSIDE the header row, beside the screen name", () => {
    setWebDesktop(true);
    renderInbox();
    // The row is the shared ScreenHeaderRow — identified by the one <h1> it
    // owns, not by a class, so this keeps holding if the styling moves.
    const h1 = screen.getByRole("heading", { level: 1, name: "Messages" });
    const row = h1.closest("div.flex.items-center");
    expect(row, "the screen name should live in the shared header row").not.toBeNull();
    expect(row!.contains(tabGroup()!)).toBe(true);
  });

  it("phone / native: the strip is on its OWN line, not crammed into the header row", () => {
    setWebDesktop(false);
    renderInbox();
    const h1 = screen.getByRole("heading", { level: 1, name: "Messages" });
    const row = h1.closest("div.flex.items-center");
    expect(row).not.toBeNull();
    const group = tabGroup();
    expect(group, "the phone strip must still render").not.toBeNull();
    expect(
      row!.contains(group!),
      "at 320 the header row has 20px beside a title that needs 88 — the strip may not go in it",
    ).toBe(false);
  });

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
