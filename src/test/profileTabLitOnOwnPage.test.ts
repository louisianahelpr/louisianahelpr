/**
 * Owner 11-05 (profile leftovers): /user/<me> now forwards to /u/<handle>, and on landing there the Profile tab went
 * dark: inTabStack only knew /user/<me>. Class: every route that shows YOUR OWN profile lights the Profile tab, and
 * someone else's profile (either form) never does.
 *
 * @mutate src/components/mobileNav/mobileNavHelpers.ts | if (tabPath === "/profile" && pathname.startsWith("/u/")) return !!myHandle && ownPublicPage(pathname, myHandle); | if (false) return true;
 * @mutate src/components/mobileNav/mobileNavHelpers.ts | return h.trim().toLowerCase() === myHandle.trim().toLowerCase(); | return true;
 * @mutate src/components/MobileNav.tsx | inTabStack(tabPath, location.pathname, user?.id, myHandle) | inTabStack(tabPath, location.pathname, user?.id)
 * @mutate src/components/mobileNav/useMyPublicHandle.ts | enabled: !!id && pathname.startsWith("/u/"), | enabled: false,
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inTabStack } from "@/components/mobileNav/mobileNavHelpers";
import { blankComments } from "@/test/helpers/blankNonCode";

const ME = "11111111-1111-4111-8111-111111111111";

describe("the Profile tab is lit on every page that shows your own profile (owner 11-05)", () => {
  const cases: Array<[string, string | null, boolean]> = [
    ["/profile", null, true],
    [`/user/${ME}`, null, true],
    ["/user/22222222-2222-4222-8222-222222222222", null, false],
    ["/u/lexi-l", "lexi-l", true],
    ["/u/Lexi-L", "lexi-l", true],
    ["/u/lexi-l/", "lexi-l", true],
    ["/u/someone-else", "lexi-l", false],
    ["/u/lexi-l", null, false], // handle unknown yet: dark, never a guess
    ["/u/lexi-l2", "lexi-l", false],
  ];
  it.each(cases)("%s (my handle %s) -> %s", (path, handle, lit) => {
    expect(inTabStack("/profile", path, ME, handle)).toBe(lit);
  });

  it("inventory: both your-own forms and both someone-else forms are covered", () => {
    expect(cases.filter(([, , lit]) => lit).length).toBeGreaterThan(3);
    expect(cases.filter(([, , lit]) => !lit).length).toBeGreaterThan(3);
  });

  it("no other tab lights on a /u page", () => {
    for (const tab of ["/home", "/jobs", "/posts", "/messages", "/explore"]) expect(inTabStack(tab, "/u/lexi-l", ME, "lexi-l"), tab).toBe(false);
  });

  it("the dock hands the viewer's own handle to the rule, read only on /u pages", () => {
    const nav = blankComments(readFileSync("src/components/MobileNav.tsx", "utf8"));
    expect(nav).toMatch(/useMyPublicHandle\(user\?\.id, location\.pathname\)/);
    expect(nav).toMatch(/inTabStack\(tabPath, location\.pathname, user\?\.id, myHandle\)/);
    const hook = blankComments(readFileSync("src/components/mobileNav/useMyPublicHandle.ts", "utf8"));
    expect(hook).toMatch(/enabled: !!id && pathname\.startsWith\("\/u\/"\)/);
    expect(hook).toMatch(/handleForUser\(/);
    expect(hook).not.toMatch(/ensureMyHandle/);
  });
});
