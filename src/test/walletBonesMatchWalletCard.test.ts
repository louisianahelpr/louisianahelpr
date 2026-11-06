/**
 * Q2708 (11-06): You › Money shifted as its parts arrived (live CLS 0.1286 after #4174, Fast 4G + 4x at 375; lab
 * 0.2451 on a dummy-backend dist, ~/.lh-shots/b2-q2708-money/). Each arrival had a loading frame of another height:
 *   1. the money tile's loading frame was not in the Suspense skeleton, so it popped in above the wallet bones;
 *   2. the wallet bones were 130px against WalletCard's 170px (two bars and an action row WalletCard no longer draws);
 *   3. "Payout history" and the bank-account section came in only once Stripe answered;
 *   4. MoneyHelp ("How does this work?") sat under all of it and was pushed down by every arrival.
 * Now the skeleton draws the tile frame, the bones are WalletCard's own markup (ghost text), the row and the section
 * hold their slots while the bones show, and MoneyHelp draws once the open half has settled. Lab after: 0.0394 (the
 * lab-only realtime bar) to 0.0526 median of 3, LCP 1200-1696 ms (was 1908-1976).
 *
 * @mutate src/components/profile/earningsTab/EarningsPageSkeleton.tsx |         <div className="h-11 w-11" /> |         <div className="h-9 w-9" />
 * @mutate src/components/profile/earningsTab/EarningsPageSkeleton.tsx |       {withHeader && <MoneyTilesLoading />} | {null}
 * @mutate src/components/profile/earningsTab/EarningsPageSkeleton.tsx |   const amount = "font-sans font-bold tabular-nums leading-none text-ds-28"; |   const amount = "font-sans font-bold tabular-nums leading-tight text-ds-28";
 * @mutate src/components/profile/earningsTab/EarningsPageSkeleton.tsx | >clearing soon</WalletGhost> | >clearing</WalletGhost>
 * @mutate src/pages/profile/ProfileTabPanels.tsx |           {moneySettled && ( |           {true && (
 * @mutate src/components/profile/EarningsTab.tsx | showPayouts={!!stripeData?.connected \|\| stripeBones} | showPayouts={!!stripeData?.connected}
 * @mutate src/components/profile/EarningsTab.tsx | !money.pending && !stripeLoading && (view | !money.pending && (view
 * @mutate src/components/profile/EarningsTab.tsx | {((stripeAnswered && stripeData?.connected) \|\| stripeBones) && ( | {stripeAnswered && stripeData?.connected && (
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", p), "utf8"));
const bodyOf = (src: string, head: string) => {
  const at = src.indexOf(head);
  expect(at, head).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf("\n}\n", at));
};

const SKELETON = read("components/profile/earningsTab/EarningsPageSkeleton.tsx");
const BONES = bodyOf(SKELETON, "export function EarningsWalletBones(");
const WALLET = bodyOf(read("components/profile/earningsTab/WalletCard.tsx"), "export function WalletCard(");

describe("You › Money: every loading frame is the height of what arrives (Q2708)", () => {
  // Each class string sets a height or a gap in WalletCard; the bones carry the same one, so the two agree.
  const SHARED = [
    "flex items-center justify-between mb-3",
    "w-9 h-9",
    "font-display font-bold leading-tight text-ds-17",
    "grid grid-cols-2 gap-4",
    "flex items-center gap-1.5 mb-1",
    "font-sans font-bold tabular-nums leading-none text-ds-28",
    "font-sans mt-1 text-ds-12",
    "border-l border-border/40 pl-4",
  ];

  it("the wallet bones use WalletCard's own layout classes", () => {
    expect(SHARED.length).toBeGreaterThan(7);
    for (const cls of SHARED) {
      expect(WALLET, `WalletCard no longer has "${cls}": update the bones with it`).toContain(cls);
      expect(BONES, `the wallet bones lack WalletCard's "${cls}"`).toContain(cls);
    }
  });

  it("the bones' fixed words are WalletCard's, and the Available line has the on-its-way sentence's shape", () => {
    const ghosts = [...BONES.matchAll(/<WalletGhost[^>]*>\s*([^<]+?)\s*<\/WalletGhost>/g)].map((m) => m[1].trim());
    expect(ghosts.length).toBeGreaterThan(4);
    expect(ghosts).toContain("Wallet");
    expect(ghosts).toContain("clearing soon");
    const wallet = read("components/profile/earningsTab/WalletCard.tsx");
    expect(wallet).toMatch(/>\s*Wallet\s*</);
    expect(wallet).toMatch(/>\s*clearing soon\s*</);
    expect(wallet).toContain("return `on its way · reaches your bank ${dayWords(");
    expect(ghosts.some((g) => /^on its way · reaches your bank [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}$/.test(g))).toBe(true);
  });

  it("the bones hold the refresh button's 44px (iconCompact is h-11) and no action row WalletCard does not draw", () => {
    expect(WALLET).toMatch(/size="iconCompact"/);
    expect(read("components/ui/button.tsx")).toMatch(/iconCompact: "h-11 w-11 /);
    expect(BONES).toContain('<div className="h-11 w-11" />');
    expect(BONES).not.toMatch(/h-9 w-full/);
  });

  it("the page skeleton draws the money tile's loading frame, the same component HomeMoneyTiles draws", () => {
    expect(SKELETON).toContain("{withHeader && <MoneyTilesLoading />}");
    expect(read("pages/home/homeDashboard/HomeMoneyTiles.tsx")).toMatch(/money\.pending && !money\.coming && !money\.held\) return <MoneyTilesLoading \/>/);
  });

  it("while the wallet bones show, Payout history and the bank-account section hold their slots", () => {
    const tab = read("components/profile/EarningsTab.tsx");
    expect(tab).toContain("const stripeBones = stripeLoading && hasStripeAccount;");
    expect(tab).toContain("<MoneyRecordRows showPayouts={!!stripeData?.connected || stripeBones} />");
    expect(tab).toContain("{((stripeAnswered && stripeData?.connected) || stripeBones) && (");
  });

  it("MoneyHelp draws only once the open half has settled (profile, tiles, Stripe, the Earned section)", () => {
    const tab = read("components/profile/EarningsTab.tsx");
    expect(tab).toContain("const settled = !!profile && !money.pending && !stripeLoading && (view === \"spent\" || (pageReady && (!showConnect || connectSettled)));");
    expect(tab).toContain("useEffect(() => { onSettled?.(settled); }, [settled, onSettled]);");
    const panels = read("pages/profile/ProfileTabPanels.tsx");
    expect(panels).toContain("onSettled={setMoneySettled}");
    expect(panels).toMatch(/\{moneySettled && \(\s*<div className="mt-4"><MoneyHelp \/><\/div>\s*\)\}/);
  });
});
