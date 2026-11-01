/**
 * BOARD 18, the rest of it (builder1e/1f, 2026-10-20): the bell sits in the
 * title row with no profile photo (you are already on your profile), a slim
 * profile card (photo with seal, name, "Verified neighbor · 5.0 · 1 review",
 * "View my public profile"), and ONE four-row list: Money · Notifications · Settings ·
 * Talk to a real person. Log out stays a clear pill; Delete account stays quiet
 * text. Spec v2 §9.8, §1.5 (every fact real or hidden), §1.1 (money in rust).
 *
 * @mutate src/components/profile/profileLanding/YouMenu.tsx |   { key: "support", label: "Talk to a real person" }, |   { key: "support", label: "Help & Support" },
 * @mutate src/components/profile/profileLanding/YouMenu.tsx |   if (money.held) return `${formatCents(money.held.cents)} held`; |   if (money.held) return `${formatCents(money.held.cents)} held`; return "$0.00";
 * @mutate src/components/profile/profileLanding/YouCard.tsx |   if (reviewCount > 0 && avgRating != null) { |   if (avgRating != null) {
 * @mutate src/components/profile/ProfileLanding.tsx | <AppTopBar title={PROFILE_PAGE_TITLE} showProfile={false} /> | <AppTopBar title={PROFILE_PAGE_TITLE} />
 * @mutate src/components/sections/AppTopBar.tsx | {user && !isWebDesktop && showProfile && ( | {user && !isWebDesktop && (
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { YOU_ROWS, YouMenuList, youMoneyCaption } from "@/components/profile/profileLanding/YouMenu";
import { VERIFIED_NEIGHBOR, youCardFacts } from "@/components/profile/profileLanding/YouCard";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", p), "utf8"));
afterEach(cleanup);

describe("You tab, board 18", () => {
  it("one list of exactly four rows, in the board's order", () => {
    expect(YOU_ROWS.map((r) => r.label)).toEqual(["Money", "Notifications", "Settings", "Talk to a real person"]);
    const picked: string[] = [];
    render(<YouMenuList captions={{ earnings: "$96.55 coming", settings: "Account, look, sections" }} onSelect={(k) => picked.push(k)} />);
    const rows = screen.getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual([
      "Money$96.55 coming", "Notifications", "SettingsAccount, look, sections", "Talk to a real person",
    ]);
    fireEvent.click(rows[2]);
    fireEvent.click(rows[3]);
    expect(picked).toEqual(["settings", "support"]);
  });

  it("the Money caption is rust, and only a real amount (never $0)", () => {
    render(<YouMenuList captions={{ earnings: "$40.00 held" }} onSelect={() => {}} />);
    const cap = document.querySelector('[data-you-caption="earnings"]') as HTMLElement;
    expect(cap.style.color).toBe("hsl(var(--accent-ink))");
    const none = { coming: null, held: null } as unknown as Parameters<typeof youMoneyCaption>[0];
    expect(youMoneyCaption(none)).toBeNull();
    const coming = { coming: { cents: 9655 }, held: { cents: 4000 } } as unknown as Parameters<typeof youMoneyCaption>[0];
    expect(youMoneyCaption(coming)).toBe("$96.55 coming");
    const held = { coming: null, held: { cents: 4000 } } as unknown as Parameters<typeof youMoneyCaption>[0];
    expect(youMoneyCaption(held)).toBe("$40.00 held");
  });

  it("the card's facts line is real or absent", () => {
    expect(youCardFacts(true, 5, 1)).toBe(`${VERIFIED_NEIGHBOR} · 5.0 · 1 review`);
    expect(youCardFacts(false, 4.25, 3)).toBe("4.3 · 3 reviews");
    expect(youCardFacts(false, 5, 0)).toBe("");
    expect(youCardFacts(true, null, 0)).toBe(VERIFIED_NEIGHBOR);
  });

  it("the title row is the shared top bar with the bell and no profile photo", () => {
    const landing = read("components/profile/ProfileLanding.tsx");
    expect(landing).toContain("<AppTopBar title={PROFILE_PAGE_TITLE} showProfile={false} />");
    expect(landing).toContain("<YouCard");
    expect(landing).toMatch(/<YouMenu onSelectTab=\{onSelectTab\} onRequestLogout=\{onRequestLogout\} onRequestDelete=\{onRequestDelete\} \/>/);
    expect(landing).not.toContain("<SettingsSection");
    const bar = read("components/sections/AppTopBar.tsx");
    expect(bar).toContain("{user && !isWebDesktop && showProfile && (");
  });

  it("Log out is a clear pill; Delete account is quiet muted text", () => {
    const menu = read("components/profile/profileLanding/YouMenu.tsx");
    // The pill is the shared Button's own (rounded-full base, buttonsArePills.test.ts) at its 48px md size.
    const logout = menu.slice(menu.lastIndexOf("<Button", menu.indexOf("onClick={onRequestLogout}")), menu.indexOf("Log out"));
    expect(logout).toMatch(/^<Button[\s\S]*size="md"/);
    expect(logout).not.toMatch(/rounded-(?!full)/);
    const del = menu.slice(menu.indexOf("onClick={onRequestDelete}"), menu.indexOf("Delete account"));
    expect(del).toMatch(/text-muted-foreground/);
    expect(del).not.toMatch(/rounded-full|destructive|--alert|bg-/);
  });
});
