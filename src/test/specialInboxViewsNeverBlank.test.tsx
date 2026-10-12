/**
 * Pinned and Recently Deleted always say something, even for an account with
 * no conversations at all. Seen on prod 2026-10-12 at 375 (poster-e2e, whose
 * inbox is empty; menu > Recently Deleted): the panel under "Showing recently
 * deleted" was blank white, with no sentence and no rows. The default-inbox
 * empty state is (rightly) skipped in those views, and the views' own empty
 * state was gated on `conversations.length > 0`, so with zero conversations
 * neither drew.
 *
 * Class: every special inbox view (each entry of the options menu) renders its
 * own empty sentence when nothing is in it, whatever the default inbox holds.
 *
 * @mutate src/components/messages/ConversationList.tsx |     !searchQuery.trim() && filteredConversations.length === 0 && (conversations.length > 0 \|\| isSpecialFilterView); |     !searchQuery.trim() && conversations.length > 0 && filteredConversations.length === 0;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

afterEach(cleanup);

function renderEmptyInbox() {
  return render(
    <MemoryRouter>
      <ConversationList
        conversations={[]}
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

/** Radix's DropdownMenu opens on pointerdown (jsdom needs the button + pointer type). */
function openOptions() {
  const trigger = screen.getByRole("button", { name: "Conversation list options" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
}

const VIEWS: Array<[string, RegExp]> = [
  ["Recently Deleted", /Nothing hidden\./],
  ["Pinned", /No conversations are pinned\./],
];

describe("special inbox views are never a blank panel", () => {
  it("the options menu offers exactly the views checked here (floor + two-way)", () => {
    renderEmptyInbox();
    openOptions();
    const offered = screen.getAllByRole("menuitem").map((m) => (m.textContent ?? "").trim());
    expect(offered.length).toBeGreaterThan(1);
    expect(offered.sort()).toEqual(VIEWS.map(([v]) => v).sort());
  });

  it.each(VIEWS)("%s with zero conversations shows its own empty sentence", async (view, sentence) => {
    renderEmptyInbox();
    // Before switching, the default inbox's empty state is up.
    expect(screen.getByText("No messages yet")).toBeInTheDocument();
    openOptions();
    const item = screen.getAllByRole("menuitem").find((m) => (m.textContent ?? "").trim() === view);
    expect(item, view).toBeDefined();
    fireEvent.click(item!);
    expect(await screen.findByText(sentence)).toBeInTheDocument();
    expect(screen.getByText("Nothing here right now")).toBeInTheDocument();
    expect(screen.queryByText("No messages yet")).toBeNull();
  });
});
