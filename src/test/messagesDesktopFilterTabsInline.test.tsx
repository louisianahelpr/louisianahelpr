/**
 * OWNER, 2026-09-19 (desktop screenshot of /messages): "in the top bar it
 * should say all un read and active. that should not be a drop down. this is
 * for desktop. on phone it will still need to drop down but the top will say
 * messages".
 *
 * THE CLASS, not the instance: a filter row that is inline on the desktop
 * website and behind a disclosure on phone must be keyed on the SAME value in
 * both places, and that value must be one the running app actually sets.
 * Messages failed that twice over — the inline strip was written but gated on
 * `embedded`, a prop no production caller passes (Messages.tsx passes
 * `embedded={false}` on both panes since the two-pane split was removed), so
 * the desktop branch had never once rendered and the chevron shipped at every
 * width. Both halves are now keyed on `useIsWebDesktop()`, the same gate
 * Activity and the in-panel header split use.
 *
 * The two assertions are exact complements, so neither can be satisfied by a
 * component that renders both placements or neither.
 *
 * @mutate src/components/messages/ConversationList.tsx | isWebDesktop && hasThreads ? <div id={INBOX_TABS_ID}> | embedded && hasThreads ? <div id={INBOX_TABS_ID}>
 * @mutate src/components/messages/ConversationList.tsx | {!isWebDesktop && hasThreads && (\n        <button | {!embedded && hasThreads && (\n        <button
 * @mutate src/components/messages/ConversationList.tsx | {!isWebDesktop && hasThreads && tabsOpen && !searchOpen && !selectMode && ( | {false && hasThreads && tabsOpen && !searchOpen && !selectMode && (
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
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
 * UPDATED 2026-09-19, LATER THE SAME DAY — the owner removed the Unread tab
 * (confirmed twice, knowing it reverses their own afternoon request). This
 * file previously asserted `["All", "Unread", "Active"]`.
 *
 * WHAT CHANGED AND WHY:
 *   - Unread is gone: Active is now the default tab (lib/inboxDefault.ts), so
 *     the landing view is already filtered to live conversations; unread is
 *     marked on the ROW; and the list already scrolls to the first unread
 *     thread on entry (028fe3837). The filter duplicated the list.
 *   - Order is Active then All: narrow to wide, landing tab first.
 *   - What did NOT change: the inline-on-desktop / disclosure-on-phone split
 *     this file was written for. That is still the contract under test.
 *
 * The assertion is still EXACT — the full set, in order — and NOT weakened to
 * "some tabs exist". An accidental third tab, a rename, or a reorder must all
 * fail here.
 */
const EXPECTED_TABS = ["Active", "All"];

describe("Messages inbox filter tabs — inline on desktop, disclosure on phone", () => {
  it("the inventory is real: this fixture produces a non-empty inbox", () => {
    // Every assertion below is gated on `hasThreads`. An empty fixture would
    // render no tabs and no chevron on BOTH surfaces and pass the desktop
    // "no chevron" half vacuously.
    setWebDesktop(false);
    renderInbox();
    expect(THREADS.length).toBeGreaterThan(1);
    expect(screen.getByRole("heading", { level: 1, name: "Messages" })).toBeTruthy();
  });

  it("desktop website (>=900px): Active / All are visible in the top bar, with no disclosure", () => {
    setWebDesktop(true);
    renderInbox();

    expect(filterTabs()).toEqual(EXPECTED_TABS);
    expect(
      disclosure(),
      "the desktop website must not hide three visible words behind a chevron",
    ).toBeNull();
  });

  it("desktop website: the tabs sit INSIDE the header row, beside the screen name", () => {
    setWebDesktop(true);
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
    // in the page: the row is the only thing between them and the <h1>.
    expect(container.querySelectorAll('[role="group"][aria-label="Filter conversations"]')).toHaveLength(1);
  });

  it("phone / native: the tabs stay behind the disclosure, and the top says Messages", () => {
    setWebDesktop(false);
    renderInbox();

    // The screen name is VISIBLE here (no app bar exists to carry it).
    const h1 = screen.getByRole("heading", { level: 1, name: "Messages" });
    expect(h1.className.includes("sr-only")).toBe(false);

    const chevron = disclosure();
    expect(chevron, "phone keeps the dropdown").not.toBeNull();
    expect(chevron!.getAttribute("aria-expanded")).toBe("false");
    expect(filterTabs(), "Messages opens COLLAPSED on phone").toEqual([]);

    fireEvent.click(chevron!);
    expect(filterTabs()).toEqual(EXPECTED_TABS);
  });
});
