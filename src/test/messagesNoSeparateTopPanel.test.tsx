/**
 * CLASS CHECK: a PageScaffold page must not wear a separate floating top
 * panel on the desktop website.
 *
 * Owner, 2026-09-16: Messages was "the only page with a separate top panel".
 * Dashboard (Dashboard.tsx:432) and Activity / My Posts / My Jobs
 * (Activity.tsx:486) both pass `titleCard={isWebDesktop ? undefined : …}` and
 * re-render the header as the panel's FIRST CHILD under a hairline at >=900px,
 * so the screen is ONE box. Messages passed `titleCard={headerEl}`
 * unconditionally, so at every width it was a floating card, a gap, then the
 * panel — two boxes where the other three had one.
 *
 * The assertion is structural, not cosmetic: at desktop width the page's
 * single <h1> must live INSIDE `.page-panel`; at phone width it must live
 * OUTSIDE it (the title card), because on phone the header carries the visible
 * page name and there is no app bar to carry it instead.
 *
 * Shown able to fail: reverting ConversationList's PageScaffold call to
 * `titleCard={headerEl}` turns the desktop case red (the h1 is back outside
 * the panel) while the phone case stays green. Registered and re-proven
 * 2026-09-21 (1 failed, 1 passed — exactly that split).
 *
 * Not mount-wiring-blind: the assertions are over the RENDERED tree, and
 * ConversationList's only mount is src/pages/Messages.tsx:393.
 *
 * @mutate src/components/messages/ConversationList.tsx | titleCard={isWebDesktop ? undefined : headerEl} | titleCard={headerEl}
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
// No network (Q55a): ConversationList's mount-time pin/archive loads read
// thread_pins / thread_archives from Supabase. See the helper.
vi.mock("@/lib/pinnedConversations", async (io) =>
  (await import("@/test/helpers/threadStoresOffline")).pinnedConversationsOffline(io));
vi.mock("@/lib/archivedConversations", async (io) =>
  (await import("@/test/helpers/threadStoresOffline")).archivedConversationsOffline(io));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(), hapticHeavy: vi.fn(),
}));

import { ConversationList } from "@/components/messages/ConversationList";

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

function renderInbox() {
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

afterEach(() => {
  cleanup();
  setWebDesktop(false);
});

describe("Messages wears the same shell as Home / My Posts / My Jobs", () => {
  it("desktop website (>=900px): the page name is INSIDE the panel — one box, no title card", () => {
    setWebDesktop(true);
    const { container } = renderInbox();

    const panel = container.querySelector(".page-panel");
    expect(panel).not.toBeNull();

    // Exactly one h1 per screen, and on desktop it is the panel's own first
    // row — not a card floating above it.
    const headings = screen.getAllByRole("heading", { level: 1, name: "Messages" });
    expect(headings).toHaveLength(1);
    expect(panel!.contains(headings[0])).toBe(true);
  });

  it("phone / native: the page name stays in the title card ABOVE the panel", () => {
    setWebDesktop(false);
    const { container } = renderInbox();

    const panel = container.querySelector(".page-panel");
    expect(panel).not.toBeNull();

    const headings = screen.getAllByRole("heading", { level: 1, name: "Messages" });
    expect(headings).toHaveLength(1);
    expect(panel!.contains(headings[0])).toBe(false);
  });
});
