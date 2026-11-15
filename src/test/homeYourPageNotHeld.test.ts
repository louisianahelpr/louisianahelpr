/**
 * Home and /profile LCP (lead 11-15; cwv-lab mobile, Slow 4G + 4x CPU at 375, the test poster, local build of main
 * e493efe530 against prod): the largest paint on both pages is the Your page card's line ("Your page is hidden right
 * now..." for a test account; the card for a member).
 * - /home 8304 / 8324 ms: Home already had the card's read answered at 5544 ms (#4581's prefetch), but the card sat
 *   inside the first-visit hold of the blocks below Next up (useHoldWhileFirstVisitReads), which waits on
 *   get_my_activity_cores (3729-8116 ms for the 831-job poster). The card now draws as soon as the handle is known;
 *   only the money tile and the section chips stay held.
 * - /profile 6812 / 6852 ms: profile row (answered 4226), then rpc_ensure_my_handle (5377-6200), then
 *   public_profile_by_handle (6204-6843), one after another. The profile row already names the handle, so the card
 *   takes it and asks the page read at once; the handle RPC is only for a profile with no handle. The landing itself
 *   mounts only once its skeleton lifts (the section switches, ~1 s after the profile row), so the page starts the
 *   card's read as soon as the profile names the handle, as Home does.
 *
 * @mutate src/pages/home/HomeDashboard.tsx |             {profile?.handle && <YourPageLink knownHandle={profile.handle} name={first ?? null} className="mb-2" />}\n            {holdBelowNextUp && <HeldBlocksSkeleton side />}\n            {!holdBelowNextUp && <>\n | {holdBelowNextUp && <HeldBlocksSkeleton side />}\n            {!holdBelowNextUp && <>\n            {profile?.handle && <YourPageLink knownHandle={profile.handle} name={first ?? null} className="mb-2" />}\n
 * @mutate src/pages/profile/Profile.tsx |     if (myHandle) void queryClient.prefetchQuery(publicPageQuery(myHandle)); |
 * @mutate src/components/profile/ProfileLanding.tsx | <YourPageLink name={displayName?.trim().split(/\s+/)[0] ?? null} knownHandle={profile?.handle} /> | <YourPageLink name={displayName?.trim().split(/\s+/)[0] ?? null} />
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";

const home = blankComments(readFileSync("src/pages/home/HomeDashboard.tsx", "utf8"));
const landing = blankComments(readFileSync("src/components/profile/ProfileLanding.tsx", "utf8"));
const profilePage = blankComments(readFileSync("src/pages/profile/Profile.tsx", "utf8"));

/** The first-visit hold's flag as Home declares it (so a rename cannot make the guard vacuous). */
const HOLD = "holdBelowNextUp";

describe("the Your page card is never held behind the activity read (home and /profile LCP)", () => {
  it("Home's hold is still the first-visit hold this guard reads", () => {
    expect(home).toMatch(new RegExp(`const ${HOLD} = useHoldWhileFirstVisitReads\\(`));
    // Inventory floor: the hold gates at least the main blocks and the side blocks.
    expect(home.split(`{${HOLD} && <HeldBlocksSkeleton`).length - 1).toBeGreaterThan(1);
  });

  it("Home draws the card in the side column ahead of, and outside, the held blocks", () => {
    const side = home.indexOf("<section data-home-side");
    const card = home.indexOf("<YourPageLink knownHandle={profile.handle}");
    expect(side).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(side);
    // The side column itself is not gated on the hold, and nothing between its start and the card is.
    const before = home.slice(Math.max(0, side - 40), side);
    expect(before).not.toContain(HOLD);
    expect(home.slice(side, card)).not.toContain(HOLD);
    // The side blocks that do wait come after the card.
    const held = home.indexOf(`{${HOLD} && <HeldBlocksSkeleton side />}`);
    expect(held).toBeGreaterThan(card);
  });

  it("/profile hands the card the handle from the profile row it already has", () => {
    expect(landing).toMatch(/<YourPageLink [^>]*knownHandle=\{profile\?\.handle(?: \?\? null)?\}/);
  });

  it("/profile starts the card's read as soon as the profile names the handle, before the landing's skeleton lifts", () => {
    const at = profilePage.indexOf("void queryClient.prefetchQuery(publicPageQuery(myHandle))");
    expect(at).toBeGreaterThan(-1);
    expect(profilePage).toMatch(/const myHandle = cachedProfile\?\.handle \?\? null;/);
    // Hooks run before the JSX; the landing (and the card in it) renders only once the skeleton lifts.
    const landingJsx = profilePage.indexOf("<ProfileLanding");
    expect(landingJsx).toBeGreaterThan(at);
  });
});
