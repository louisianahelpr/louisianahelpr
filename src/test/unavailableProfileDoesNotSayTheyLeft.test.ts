/**
 * F271a (whole-app audit 11-10, W2): /book/<id> for two live test accounts said "the account is no longer on Helpr".
 * get_safe_profiles returns no row for more than a departed member: an unverified email, a ban, an anonymised
 * account, and (Q552, newest definition in supabase/migrations/20261103154905_tip_waits_on_id_in_safe_profiles.sql)
 * a test account once the launch switch is on. The page cannot tell these apart, so it must not claim the person left.
 * The three "no public profile" states (/book, the /u forward, the public profile page) say the profile isn't public
 * right now and keep their way on.
 *
 * @mutate src/pages/book/BookHelprPage.tsx | or this profile isn't public right now. You can still | or the account is no longer on Helpr. You can still
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => blankComments(readFileSync(join(ROOT, p), "utf8"));

const PAGES = [
  "src/pages/book/BookHelprPage.tsx",
  "src/components/profile/PublicProfileForward.tsx",
  "src/pages/u/PublicProfilePage.tsx",
];

describe("a missing public profile never claims the member left (F271a)", () => {
  it.each(PAGES)("%s says the profile isn't public, not that the account is gone", (p) => {
    const src = read(p);
    expect(src).not.toMatch(/no longer on Helpr/);
    expect(src).toContain("this profile isn't public right now");
  });

  it("the source of the null card lists more causes than a departed member", () => {
    const src = read("src/lib/bookMe.ts");
    expect(src).toMatch(/if \(!p\) return null;/);
    const comment = readFileSync(join(ROOT, "src/lib/bookMe.ts"), "utf8");
    expect(comment).toMatch(/banned, deleted, unverified, hidden test account/);
  });
});
