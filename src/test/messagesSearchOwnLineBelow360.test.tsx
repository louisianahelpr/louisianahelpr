/**
 * MESSAGES SEARCH ON A PHONE: ITS OWN SLIM ROW, AT EVERY PHONE WIDTH.
 *
 * Q143 (owner, 2026-09-23) put the search field on its own line below 360px,
 * because the header row had no room for it at 320. Q2231 (owner, 2026-10-19)
 * finished that thought for every phone width: the top bar is the shared
 * AppTopBar (title · bell · profile), and the search field is ALWAYS on its
 * own slim row under the section tabs, with the one "more" menu inside it. So
 * at 320 and at 375 alike: the field is in the search row, nothing searchable
 * is in the top bar, and there is no magnifier to press.
 */
// @mutate src/components/messages/ConversationList.tsx |   const headerEl = phoneTopBar && !selectMode ? ( |   const headerEl = false ? (
// @mutate src/components/messages/ConversationList.tsx |       {phoneSearchRow}\n | \n
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
// The phone header is the shared AppTopBar since Q2231; its bell and avatar
// need the app's providers, and this file tests the list, not the bar.
vi.mock("@/components/sections/AppTopBar", () => ({
  AppTopBar: ({ title }: { title?: string }) => <header data-testid="app-top-bar"><h1>{title}</h1></header>,
}));


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

function renderInbox() {
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
}

afterEach(() => {
  cleanup();
  setViewport(1024);
});

describe("Messages search on a phone: its own slim row (Q143 -> Q2231)", () => {
  for (const width of [320, 375]) {
    it(`${width}: the field is in the search row, never in the top bar, with no magnifier to press`, () => {
      setViewport(width);
      renderInbox();
      const row = screen.getByTestId("messages-search-row");
      const field = within(row).getByRole("searchbox", { name: "Search conversations" });
      expect(field).toBeTruthy();
      expect(within(row).getByRole("button", { name: "Inbox views and options" })).toBeTruthy();
      expect(screen.getByTestId("app-top-bar").contains(field)).toBe(false);
      expect(screen.queryByRole("button", { name: "Search conversations" })).toBeNull();
      fireEvent.change(field, { target: { value: "faucet" } });
      expect((field as HTMLInputElement).value).toBe("faucet");
      expect(within(row).getByRole("button", { name: "Clear search" })).toBeTruthy();
    });
  }
});
