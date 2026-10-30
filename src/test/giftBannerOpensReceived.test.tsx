/**
 * "SEE THEM" ON POST A JOB'S GIFT BANNER SHOWS THE CARDS (audit 2026-10-29 A2-C26).
 *
 * The bug: "18 Helpr gift cards waiting for you · See them" linked to /profile?tab=gift_card, which opens at the
 * send-a-gift form; the cards waiting for the viewer were below it, off the first screen.
 * The fix: the link carries ?show=received and the tab scrolls to "Gift cards sent to you" once its lists load.
 *
 * @mutate src/pages/post-job/GiftCardTeaser.tsx | <Link to={GIFT_RECEIVED_HREF} className | <Link to="/profile?tab=gift_card" className
 * @mutate src/pages/profile/GiftCard.tsx | <div id={GIFT_RECEIVED_ID} className="scroll-mt-4"> | <div>
 * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | tab=gift_card&show=received&user= | tab=gift_card&user=
 * @mutate supabase/functions/void-cancelled-payments/index.ts | link: "/profile?tab=gift_card&show=received" | link: "/profile?tab=gift_card"
 * @mutate src/pages/profile/giftCards/useShowReceivedGifts.ts |     if (!wanted \|\| !ready \|\| done.current) return; |     if (!ready \|\| done.current) return;
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GiftCardTeaser from "@/pages/post-job/GiftCardTeaser";
import { GIFT_RECEIVED_HREF, GIFT_RECEIVED_ID, useShowReceivedGifts } from "@/pages/profile/giftCards/useShowReceivedGifts";
import { blankComments } from "./helpers/blankNonCode";

function Probe({ ready }: { ready: boolean }) {
  useShowReceivedGifts(ready);
  return <div id={GIFT_RECEIVED_ID}>Gift cards sent to you</div>;
}

function mount(url: string, ready: boolean) {
  const spy = vi.fn();
  Element.prototype.scrollIntoView = spy;
  const r = render(<MemoryRouter initialEntries={[url]}><Probe ready={ready} /></MemoryRouter>);
  return { spy, ...r };
}

describe("See them opens the cards waiting for you (A2-C26)", () => {
  it("the banner's link asks the Gift card tab for its received cards", () => {
    render(<MemoryRouter><GiftCardTeaser userId="u1" ids={["a", "b"]} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "See them" })).toHaveAttribute("href", "/profile?tab=gift_card&show=received");
    expect(GIFT_RECEIVED_HREF).toBe("/profile?tab=gift_card&show=received");
  });

  it("with ?show=received the tab scrolls to the received block once the lists are in, and only once", () => {
    const { spy, rerender } = mount("/profile?tab=gift_card&show=received", false);
    expect(spy).not.toHaveBeenCalled();
    rerender(<MemoryRouter initialEntries={["/profile?tab=gift_card&show=received"]}><Probe ready /></MemoryRouter>);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.contexts[0]).toHaveProperty("id", GIFT_RECEIVED_ID);
  });

  it("without the param (the tab opened from Profile) nothing scrolls", () => {
    const { spy } = mount("/profile?tab=gift_card", true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("the Gift card tab wears the id on its received block and calls the hook", () => {
    const page = blankComments(readFileSync(resolve(__dirname, "../pages/profile/GiftCard.tsx"), "utf8"));
    expect(page).toMatch(/useShowReceivedGifts\(!listsLoading\)/);
    const at = page.indexOf("<div id={GIFT_RECEIVED_ID}");
    expect(at).toBeGreaterThan(0);
    expect(page.slice(at, at + 400)).toContain("Gift cards sent to you");
  });

  // #16: "You received a Helpr credit!" opened the same send-a-gift form. Every notice that sends a member to the
  // Gift card tab is about a credit they hold, so each one asks for the received cards. Built from the functions
  // themselves: a new notice with a bare link fails here. Checkout return URLs and the claim link are not notices.
  it("every notice linking to the Gift card tab opens the received cards", () => {
    const functionsDir = resolve(__dirname, "../../supabase/functions");
    const links: string[] = [];
    for (const f of (readdirSync(functionsDir, { recursive: true }) as string[]).filter((x) => x.endsWith(".ts"))) {
      const src = blankComments(readFileSync(resolve(functionsDir, f), "utf8"));
      for (const m of src.matchAll(/\blink:\s*["'`](\/profile\?tab=gift_card[^"'`]*)["'`]/g)) links.push(`${f}: ${m[1]}`);
    }
    expect(links.length).toBeGreaterThan(1);
    expect(links.filter((l) => !l.includes("&show=received"))).toEqual([]);
  });
});
