/**
 * OWNER, 2026-09-19: "messages need to fill the screen." — the inbox half.
 *
 * THE CLASS: a scroll container may reserve bottom clearance for the floating
 * nav dock only at widths where the dock is actually painted. Reserving it
 * where the dock is hidden is dead scroll space; NOT reserving it where the
 * dock is painted hides the last row behind it. Both directions are asserted
 * here, because a guard that only checks one of them licenses the other.
 *
 * The inbox had the dead half: `paddingBottom` was `safe-area + 96px` at every
 * width, trimmed only under `embedded` — a prop no production caller passes —
 * while `html.web-desktop .mobile-nav-frame { display: none !important }`
 * removes the dock (pill AND Post FAB, one frame) at >=900px. With the panel
 * running flush to the viewport floor on desktop (owner, 2026-09-16: panels
 * are not curved at the bottom), that reserve read as the list stopping short
 * of the screen.
 *
 * THE THIRD TEST IS THE IMPORTANT ONE. The component gates on
 * `useIsWebDesktop()`; the dock is hidden by the `web-desktop` CLASS, which
 * `useAppShellViewport` toggles from its own copy of the media query. Two
 * literals in two files that must be the same string — exactly the "a class
 * and a hook agreeing by luck" shape. If they drift, this padding comes off at
 * a width where the dock is still painted and the last thread hides behind it.
 * Read from the files themselves, never from a list this test also owns.
 *
 * @mutate src/components/messages/ConversationList.tsx | paddingBottom: isWebDesktop\n                ? "calc(var(--safe-area-bottom, 0px) + 1rem)" | paddingBottom: embedded\n                ? "calc(var(--safe-area-bottom, 0px) + 1rem)"
 * @mutate src/components/messages/ConversationList.tsx | : "var(--dock-clearance)",\n            }} | : "calc(var(--safe-area-bottom, 0px) + 1rem)",\n            }}
 * @mutate src/hooks/useIsWebDesktop.ts | const WEB_DESKTOP_QUERY = "(min-width: 900px)"; | const WEB_DESKTOP_QUERY = "(min-width: 1024px)";
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
import type { Conversation } from "@/components/messages/types";

const REPO = resolve(__dirname, "..", "..");
const readRepo = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

/** The dock clearance AppShell reserves — read from AppShell, not retyped. */
function dockClearance(): string {
  const m = /reserveBottomNav\s*\n?\s*\?\s*"([^"]+)"/.exec(readRepo("src/components/AppShell.tsx"));
  if (!m) throw new Error("AppShell's reserveBottomNav clearance no longer parses — fix this reader, do not hardcode the value.");
  return m[1];
}

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
 * The thread list's own scroll box (PullToRefreshWrapper). Found by the
 * overflow that makes it a scroller, then narrowed to the one that holds the
 * rows — not by a testid the component would have to carry for this test.
 */
function scroller(container: HTMLElement): HTMLElement {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(".overflow-auto")).filter(
    (el) => el.className.includes("flex-1"),
  );
  expect(
    candidates.length,
    "expected exactly one inbox scroll container; the list body's shape changed",
  ).toBe(1);
  return candidates[0];
}

/** React writes it as an inline style; read the attribute so `calc()` survives jsdom. */
function paddingBottomOf(el: HTMLElement): string {
  const m = /padding-bottom:\s*([^;]+)/.exec(el.getAttribute("style") ?? "");
  return (m?.[1] ?? "").trim();
}

afterEach(() => {
  cleanup();
  setWebDesktop(false);
});

describe("inbox bottom clearance is reserved only where the dock is painted", () => {
  it("phone / native: the FULL dock clearance is reserved, exactly as AppShell defines it", () => {
    setWebDesktop(false);
    const { container } = renderInbox();
    expect(
      paddingBottomOf(scroller(container)),
      "the floating dock and Post FAB are painted here; without this the last " +
        "thread sits behind them.",
    ).toBe(dockClearance());
  });

  it("desktop website (>=900px): no dock clearance — the dock is not painted there", () => {
    setWebDesktop(true);
    const { container } = renderInbox();
    const pad = paddingBottomOf(scroller(container));
    expect(
      pad,
      "the desktop website reserves scroll space for a dock that index.css hides; " +
        "that is dead space at the bottom of the inbox.",
    ).not.toBe(dockClearance());
    expect(pad).not.toMatch(/96px/);
    // A real gutter, not zero: the panel has no bottom edge on desktop, so the
    // last row would otherwise sit on the viewport floor.
    expect(pad, "desktop still needs breathing room under the last row").toBe(
      "calc(var(--safe-area-bottom, 0px) + 1rem)",
    );
  });

  it("the gate and the thing it stands in for are the SAME threshold", () => {
    // 1. The hook this component gates on, and the hook that puts `web-desktop`
    //    on <html>, must use the identical media query. Two literals, two
    //    files; nothing but this test stops them drifting apart.
    const hookQuery = /const WEB_DESKTOP_QUERY = "([^"]+)"/.exec(
      readRepo("src/hooks/useIsWebDesktop.ts"),
    )?.[1];
    const classQuery = /export const WEB_DESKTOP_QUERY = "([^"]+)"/.exec(
      readRepo("src/hooks/useAppShellViewport.ts"),
    )?.[1];
    expect(hookQuery, "useIsWebDesktop.ts no longer declares WEB_DESKTOP_QUERY").toBeTruthy();
    expect(classQuery, "useAppShellViewport.ts no longer exports WEB_DESKTOP_QUERY").toBeTruthy();
    expect(
      hookQuery,
      "useIsWebDesktop() and the `web-desktop` class are driven by DIFFERENT " +
        "breakpoints. The inbox drops its dock clearance on the hook's word " +
        "while the dock is hidden on the class's, so between the two widths " +
        "the last thread hides behind a dock that is still painted. Import the " +
        "one exported constant instead of keeping two copies.",
    ).toBe(classQuery);

    // 2. And the dock really is hidden by that class, not by some other rule.
    const css = readRepo("src/index.css").replace(/\s+/g, " ");
    expect(
      css,
      "the rule that hides the floating dock on desktop is no longer keyed on " +
        "`html.web-desktop .mobile-nav-frame`; re-derive what this padding gates on.",
    ).toMatch(/html\.web-desktop \.mobile-nav-frame \{ display: none !important; \}/);
  });
});
