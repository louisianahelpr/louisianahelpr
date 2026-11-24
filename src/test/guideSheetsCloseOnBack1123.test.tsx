/**
 * Flow audit 11-23 (B4): on a phone, Back / swipe-back with the guides' "Save for someone" sheet or the "My Wish List"
 * (My lists) sheet open left the whole guide (iPhone WebKit: Her guide -> heart -> Back landed on /gift-guides). Each
 * sheet now holds one history entry while open: Back closes the sheet and stays on the guide; closing it with Done
 * takes the entry back off, so the next Back leaves the page as before.
 *
 * @mutate src/pages/info/giftGuides/SaveForSomeone.tsx |   useCloseOnBack(item !== null, close); |   void close;
 * @mutate src/pages/info/giftGuides/SaveForSomeone.tsx |   useCloseOnBack(open, closeMyLists); |   void open;
 * @mutate src/hooks/useCloseOnBack.ts |       window.history.pushState({ ...prev, [MARK]: true }, ""); |       void prev;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: null, isReady: true }) }));
vi.mock("@/lib/giftGuideFunApi", () => ({
  revealSecretSanta: vi.fn(), setSecretSantaWishList: vi.fn(), createSecretSanta: vi.fn(),
  SantaSaveError: class extends Error {}, loadAccountPlan: vi.fn(async () => null), saveAccountPlan: vi.fn(async () => undefined),
}));
vi.mock("@/lib/giftWishListApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/giftWishListApi")>()),
  shareGiftLists: vi.fn(async () => "abcdef123456"), getSharedList: vi.fn(), getMyWishList: vi.fn(async () => null), saveWishList: vi.fn(async () => "abcdef123456"),
}));

import { SaveForSomeone } from "@/pages/info/giftGuides/SaveForSomeone";
import { closeMyLists, closeSaveFor, openMyLists, requestSaveFor } from "@/pages/info/giftGuides/saveForPeople";

const GIFT = { href: "https://www.amazon.com/dp/B0CFFZ389Y", name: "Test toothbrush", guide: "kids" };
const mount = () => render(<MemoryRouter><SaveForSomeone /></MemoryRouter>);
const back = async () => { await act(async () => { window.history.back(); await new Promise((r) => setTimeout(r, 30)); }); };
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

afterEach(async () => {
  act(() => { closeSaveFor(); closeMyLists(); });
  await tick();
  cleanup();
});

describe("guide sheets close on Back (B4)", () => {
  const cases = [
    { name: "Save for someone", open: () => requestSaveFor(GIFT), sel: "[data-savefor-picker]" },
    { name: "My Wish List", open: () => openMyLists("me"), sel: "[data-mylists-panel]" },
  ];
  expect(cases.length).toBeGreaterThan(1);
  for (const c of cases) {
    it(`${c.name}: Back closes the sheet and keeps the page; Done takes its history entry back off`, async () => {
      mount();
      const startUrl = window.location.pathname + window.location.search;
      act(() => { c.open(); });
      await waitFor(() => expect(document.querySelector(c.sel)).not.toBeNull());
      expect((window.history.state as Record<string, unknown> | null)?.lhSheet).toBe(true);
      await back();
      await waitFor(() => expect(document.querySelector(c.sel)).toBeNull());
      expect(window.location.pathname + window.location.search).toBe(startUrl);

      // Open again: closing with Done leaves the history where it was (no stray entry for the next Back).
      act(() => { c.open(); });
      await waitFor(() => expect(document.querySelector(c.sel)).not.toBeNull());
      const s = window.history.state as Record<string, unknown> | null;
      expect(s?.lhSheet).toBe(true);
      const done = screen.getAllByRole("button").find((b) => /done|close/i.test(b.textContent ?? "") || /close/i.test(b.getAttribute("aria-label") ?? ""))!;
      fireEvent.click(done);
      await waitFor(() => expect(document.querySelector(c.sel)).toBeNull());
      await tick();
      expect((window.history.state as Record<string, unknown> | null)?.lhSheet).not.toBe(true);
    });
  }
});
