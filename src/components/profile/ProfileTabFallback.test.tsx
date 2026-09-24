import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProfileTabFallback } from "./ProfileTabFallback";
import { TAB_TITLES, type Tab } from "@/pages/profile/types";

/**
 * THE OWNER'S RULING, AS A CHECK — "skeleton fills the screen, grows below"
 * (2026-09-19, decided in a pop-up after the report that loading states "jump
 * and are not consistent with their info").
 *
 * Three properties, and every one of them was measurably FALSE before:
 *
 *   1. THE TITLE IS THERE FROM THE FIRST FRAME. Measured at 375 against prod
 *      with each tab's own module held back: no `<h1>` in the loading frame,
 *      an `<h1>` at y=26 in the loaded frame — so all twenty-four tabs slid
 *      their entire body down by a page header's height on arrival.
 *   2. THE RESERVE IS ONE SCREENFUL, taken from the viewport rather than
 *      hard-coded. It was 118px against real content of 447–3,477px.
 *   3. THE RESERVE IS EMPTY BELOW THE BONES. This is the half of the ruling
 *      that handles SHORT tabs: Account Security's real content is 44px, so a
 *      screenful of drawn bones would paint ~700px of grey and then visibly
 *      collapse. Reserving with `min-height` and leaving the space blank means
 *      a short tab settles with nothing visible disappearing.
 *
 * The inventory is TAB_TITLES itself — the registry the router and
 * `document.title` already share — so a tab added tomorrow is asserted
 * tomorrow, with a floor that fails loudly if that import ever comes back
 * empty.
 */

const TABS = Object.keys(TAB_TITLES) as Exclude<Tab, "landing">[];

const renderFallback = (tab: Exclude<Tab, "landing">) =>
  render(
    <MemoryRouter>
      <ProfileTabFallback tab={tab} />
    </MemoryRouter>,
  );

describe("ProfileTabFallback — the ruling, asserted", () => {
  it("the inventory is the app's own and is not empty", () => {
    expect(TABS.length, "TAB_TITLES came back empty — this suite would pass vacuously").toBeGreaterThanOrEqual(20);
  });

  it("every tab's placeholder paints that tab's real title, not a bone", () => {
    const wrong: string[] = [];
    for (const tab of TABS) {
      const { container } = renderFallback(tab);
      const h1 = container.querySelector("h1");
      const text = (h1?.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text !== TAB_TITLES[tab]) wrong.push(`${tab}: h1 is ${JSON.stringify(text)}, expected ${JSON.stringify(TAB_TITLES[tab])}`);
      cleanup();
    }
    expect(wrong, "the loading header must already be the final header").toEqual([]);
  });

  it("reserves ONE SCREENFUL, measured from the viewport", () => {
    const { container } = renderFallback("gift_card");
    const reserve = container.querySelector<HTMLElement>('[data-testid="profile-tab-fallback"]');
    expect(reserve, "no reserve element rendered").not.toBeNull();
    const min = parseFloat(reserve!.style.minHeight || "0");
    // jsdom puts every rect at y=0, so the reserve resolves to the full
    // viewport height. What is asserted is that it is VIEWPORT-DERIVED and
    // substantial — a hard-coded 118px, or none at all, fails here.
    expect(min, `minHeight was ${JSON.stringify(reserve!.style.minHeight)}`).toBeGreaterThanOrEqual(
      window.innerHeight * 0.5,
    );
  });

  it("fills the reserve with SPACE, not with bones (short tabs settle flat)", () => {
    const { container } = renderFallback("security");
    const reserve = container.querySelector<HTMLElement>('[data-testid="profile-tab-fallback"]');
    const bones = reserve!.querySelectorAll('[class*="shimmer"], [class*="animate-pulse"]');
    // A screenful of drawn bones is the variant the owner DECLINED. The
    // reserve is a min-height; the drawn furniture stays a couple of cards.
    expect(bones.length, "the screenful is being drawn rather than reserved").toBeLessThanOrEqual(12);
    expect(bones.length, "no bones at all is not a placeholder").toBeGreaterThan(0);
    expect(reserve!.children.length, "more than a couple of bone cards is a drawn screenful").toBeLessThanOrEqual(3);
  });

  it("Profile's boot skeleton is the tab's placeholder, never the landing's", () => {
    // The other half of "not consistent with their info": a cold deep link
    // into ?tab=gift_card used to paint the LANDING skeleton — an avatar hero
    // and three stat tiles — because the boot branch special-cased exactly one
    // tab. Read from the source, because this branch runs before any query
    // resolves and no render test reaches it.
    const src = readFileSync(resolve(__dirname, "../../pages/profile/Profile.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    const branch = src.slice(src.indexOf("if (loading) {"), src.indexOf("const displayName"));
    expect(branch.length, "Profile.tsx's loading branch was not found — this guard has rotted").toBeGreaterThan(100);
    expect(branch, "the boot skeleton must render the tab's own placeholder").toContain("ProfileTabFallback");
    // The PAIRING, not the presence of either half: `/tab === "landing"/`
    // on its own is satisfied by the container's `pt-3` gate a few lines up
    // in the same branch. What must hold is that ProfilePageSkeleton is what
    // the landing test selects.
    expect(
      /tab === "landing"\s*\?\s*\(\s*<ProfilePageSkeleton/.test(branch),
      "the LANDING skeleton must be what the landing test selects, not the default",
    ).toBe(true);
  });
});
// Proof this guard can fail (scripts/vacuity). The two halves of the owner's
// ruling, one mutation each: strip the real header and the placeholder is back
// to a bone that shifts every tab's body down on arrival; hard-code the reserve
// and it is the measured 118px against 447-3,477px of real content again.
// @mutate src/components/profile/ProfileTabFallback.tsx | <ProfileTabHeader title={TAB_TITLES[tab]} onBack={onBack} /> |
// @mutate src/components/profile/ProfileTabFallback.tsx | setReserve(Math.max(0, Math.round(window.innerHeight - top))); | setReserve(118);
