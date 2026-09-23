/**
 * MESSAGES SEARCH BELOW 360px OPENS ON ITS OWN LINE (Q143).
 *
 * Owner decision 2026-09-23 (docs/OPEN.md MORNING QUESTIONS, Q48 option D):
 * below 360px the Messages search opens on its own line, where the Active/All
 * tab strip sits, full width; 375 and up unchanged.
 *
 * Why: at 320 the header row cannot hold a typable field beside the cluster.
 * With the magnifier's slot held open the field measured 90px against the
 * 120px floor (MIN_TYPABLE_FIELD_PX); without the slot the ✕ sat 28px over the
 * returning magnifier (e2e/prod-audit/expanding-search-geometry.spec.ts, the
 * failing messages@320 case).
 *
 * jsdom has no layout, so this pins the ARRANGEMENT the geometry depends on —
 * which parent the field is in at each width — and the browser spec measures
 * the pixels (field width, ✕ vs magnifier, overflow) at 320 / 375 / 1440:
 *   320 (max-width: 359px matches): the field is in [data-search-own-line],
 *       NOT in the header row; the header row keeps its visible name, holds the
 *       magnifier's slot, and keeps the hamburger;
 *   375 (no match): the field is in the header row (ScreenHeaderRow's
 *       expandingSearch), and there is no own line.
 */
// PROOF THIS GUARD CAN FAIL (npm run vacuity):
// the own-line arrangement never switches on (the 320 case fails);
// @mutate src/components/messages/ConversationList.tsx | const SEARCH_OWN_LINE_QUERY = "(max-width: 359px)"; | const SEARCH_OWN_LINE_QUERY = "(max-width: 1px)";
// the field is left in the row as well as on the line (the 320 case fails);
// @mutate src/components/messages/ConversationList.tsx | open: searchOpen && !selectMode && !searchOnOwnLine, | open: searchOpen && !selectMode,
// the own line also opens at 375 (the 375 case fails).
// @mutate src/components/messages/ConversationList.tsx | const searchOnOwnLine = useSearchOnOwnLine() && !isWebDesktop; | const searchOnOwnLine = !isWebDesktop;
import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/pinnedConversations", async (io) =>
  (await import("@/test/helpers/threadStoresOffline")).pinnedConversationsOffline(io));
vi.mock("@/lib/archivedConversations", async (io) =>
  (await import("@/test/helpers/threadStoresOffline")).archivedConversationsOffline(io));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(), hapticHeavy: vi.fn(),
}));

import { ConversationList } from "@/components/messages/ConversationList";
import type { Conversation } from "@/components/messages/types";

/** A phone viewport `width` px wide: answers max-/min-width queries honestly. */
function setViewport(width: number) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => {
      const max = /max-width:\s*(\d+)px/.exec(query);
      const min = /min-width:\s*(\d+)px/.exec(query);
      const matches = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]));
      return {
        matches, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
      };
    },
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
];

function openSearch() {
  render(
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
  fireEvent.click(screen.getByRole("button", { name: "Search conversations" }));
  return screen.getByRole("searchbox", { name: "Search conversations" });
}

/** The header row: the nearest ancestor of the h1 that also holds the hamburger. */
function headerRow(): HTMLElement {
  const h1 = screen.getByRole("heading", { level: 1, name: "Messages" });
  const menu = screen.getByRole("button", { name: "Conversation list options" });
  let n: HTMLElement | null = h1.parentElement;
  while (n && !n.contains(menu)) n = n.parentElement;
  if (!n) throw new Error("no header row holds both the h1 and the hamburger");
  return n;
}

afterEach(() => {
  cleanup();
  setViewport(1024);
});

describe("Messages search below 360px opens on its own line (Q143)", () => {
  it("320: the field is on its own line, and the header row stays at rest", () => {
    setViewport(320);
    const field = openSearch();
    const line = document.querySelector<HTMLElement>("[data-search-own-line]");
    expect(line, "no own search line at 320").not.toBeNull();
    expect(line!.contains(field)).toBe(true);
    const row = headerRow();
    expect(row.contains(field), "the field is still in the header row at 320").toBe(false);
    // The row at rest: the visible h1 (not the sr-only open-row twin), the
    // held magnifier slot, and the hamburger all still there.
    expect(within(row).getByRole("heading", { level: 1 }).className).not.toContain("sr-only");
    expect(row.querySelectorAll("[data-search-trigger-slot]")).toHaveLength(1);
    expect(within(row).getByRole("button", { name: "Conversation list options" })).toBeTruthy();
    // And the ✕ is on the line, not the row.
    expect(within(line!).getByRole("button", { name: "Close search" })).toBeTruthy();
  });

  it("375: unchanged — the field opens in the header row, no own line", () => {
    setViewport(375);
    const field = openSearch();
    expect(document.querySelector("[data-search-own-line]")).toBeNull();
    const h1 = screen.getByRole("heading", { level: 1, name: "Messages" });
    expect(h1.className).toContain("sr-only");
    expect(h1.parentElement!.contains(field)).toBe(true);
  });

  it("closing from the own line puts the magnifier back and removes the line", () => {
    setViewport(320);
    openSearch();
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    expect(document.querySelector("[data-search-own-line]")).toBeNull();
    expect(screen.getByRole("button", { name: "Search conversations" })).toBeTruthy();
  });
});
