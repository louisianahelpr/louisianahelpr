/**
 * The gift card banner lives at the top of Post a Job, not on /home, and its
 * X dismisses it for this set of gifts (owner, 2026-10-01: "remove it from
 * /home, put it at the top of Post a Job, add an x on the right side").
 * Shown able to fail: with the dismissed check dropped, the X and private-mode tests red.
 * @mutate src/pages/post-job/GiftCardTeaser.tsx | if (count <= 0 \|\| dismissed === signature) return null; | if (count <= 0) return null;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ComponentProps } from "react";

const gift = vi.hoisted(() => ({
  value: { userId: "user-1" as string | undefined, ids: ["g1", "g2"], settled: true },
}));

vi.mock("@/hooks/useSpendableGiftCards", () => ({
  useSpendableGiftCards: () => gift.value,
}));
vi.mock("@/hooks/useRecentPostedJobs", () => ({ useRecentPostedJobs: () => [] }));
vi.mock("./useDraftCheckoutState", () => ({ useDraftCheckout: () => ({ state: null, settled: true }) }));
vi.mock("./OfferToSavedHelpr", () => ({
  useSavedHelpersLite: () => ({ data: [], fetchStatus: "idle", status: "success" }),
  OfferToSavedHelpr: () => null,
}));
vi.mock("@/components/postjob/AiJobBuilder", () => ({ AiJobBuilder: () => null }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { EntryChoice } from "./EntryChoice";
import { giftBannerDismissKey } from "./GiftCardTeaser";

type Form = ComponentProps<typeof EntryChoice>["form"];
const form = {
  draftLoaded: true,
  hasDraft: false,
  openJobCount: 0,
  startFresh: vi.fn(),
  setStep: vi.fn(),
  useTemplate: vi.fn(),
  applyAiJob: vi.fn(),
  applyTemplateFields: vi.fn(),
  loadDraftAndContinue: vi.fn(),
} as unknown as Form;

const renderEntry = (url = "/post-job") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <EntryChoice form={form} />
    </MemoryRouter>,
  );

const banner = () => screen.queryByText(/Helpr gift cards? waiting for you/);

describe("gift card banner", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    gift.value = { userId: "user-1", ids: ["g1", "g2"], settled: true };
  });

  it("renders at the top of Post a Job's entry screen, linking to the gift tab", () => {
    renderEntry();
    expect(banner()).toHaveTextContent("2 Helpr gift cards waiting for you");
    expect(screen.getByRole("link", { name: "See them" })).toHaveAttribute("href", "/profile?tab=gift_card");
    // First in the column: above Start fresh.
    const col = banner()!.closest(".flex.flex-col.gap-3")!;
    expect(col.firstElementChild!.textContent).toMatch(/waiting for you/);
  });

  it("stays out of the way while a gift is already being spent (?gift_card=)", () => {
    renderEntry("/post-job?gift_card=g1");
    expect(banner()).toBeNull();
  });

  it("is not on /home: the Dashboard and its feed no longer render it", () => {
    for (const f of ["src/pages/home/Dashboard.tsx", "src/components/dashboard/BrowseTasksFeed.tsx", "src/pages/home/useDashboardSideQueries.ts"]) {
      const src = readFileSync(resolve(process.cwd(), f), "utf8");
      expect(src, f).not.toMatch(/GiftCardTeaser|useSpendableGiftCards|giftCardCount|gift_cards/);
    }
  });

  it("the X hides it, and it stays hidden on the next visit", () => {
    renderEntry();
    const x = screen.getByRole("button", { name: "Dismiss" });
    expect(x.className).toMatch(/\bw-11\b/);
    expect(x.className).toMatch(/\bh-11\b/);
    fireEvent.click(x);
    expect(banner()).toBeNull();
    expect(localStorage.getItem(giftBannerDismissKey("user-1"))).toBe("g1,g2");
    cleanup();
    renderEntry();
    expect(banner()).toBeNull();
  });

  it("a NEW gift card brings it back; another user's dismissal does not hide it", () => {
    localStorage.setItem(giftBannerDismissKey("user-1"), "g1,g2");
    gift.value = { userId: "user-1", ids: ["g1", "g2", "g3"], settled: true };
    renderEntry();
    expect(banner()).toHaveTextContent("3 Helpr gift cards waiting for you");
    cleanup();
    gift.value = { userId: "user-2", ids: ["g1", "g2"], settled: true };
    renderEntry();
    expect(banner()).not.toBeNull();
  });

  it("survives storage that throws (private mode)", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      renderEntry();
      expect(banner()).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(banner()).toBeNull();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});
