/**
 * F085 (owner UI audit 11-09): the admins' new-member summary read "Annette Washum Annette Washum from Scott". The
 * summary prints profiles.full_name as stored; the name was stored doubled because sign-up joined the First and Last
 * boxes blindly and the member had typed the whole name into both (prod 11-09, read-only: 3 of 349 profiles match
 * '^(.+) \1$', all email sign-ups, raw_user_meta_data.full_name already doubled). Fixed where the name is built:
 * every screen that saves full_name from the two boxes goes through joinName, which never says a name twice.
 *
 * @mutate src/lib/splitName.ts |   if (first === last && first.includes(" ")) return first; |   if (first === last && first.includes("@")) return first;
 * @mutate src/pages/auth/Signup.tsx |   const fullName = joinName(firstName, lastName); |   const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
 * @mutate src/pages/profile/Profile.tsx |     const merged = joinName(firstName, lastName); |     const merged = `${firstName.trim()} ${lastName.trim()}`.trim();
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";
import { joinName } from "@/lib/splitName";

const ROOT = join(__dirname, "..", "..");

describe("joinName never says a name twice (F085)", () => {
  it.each([
    ["Annette Washum", "Annette Washum", "Annette Washum"],
    [" Annette  Washum", "Annette Washum ", "Annette Washum"],
    ["Andrea M Martinez", "Andrea M Martinez", "Andrea M Martinez"],
    // Real names, kept whole (the data fix's rule: only an exact repeat of two or more words).
    ["Lee", "Lee", "Lee Lee"],
    ["John Paul", "Paul", "John Paul Paul"],
    ["Jordan", "Jordan Smith", "Jordan Jordan Smith"],
    ["annette washum", "Annette Washum", "annette washum Annette Washum"],
    ["  Mindy ", " Braquet  ", "Mindy Braquet"],
    ["Mary  Ann", "Smith", "Mary Ann Smith"],
    ["Jo", "Jones", "Jo Jones"],
    ["Ann", "Annette", "Ann Annette"],
    ["", "Braquet", "Braquet"],
    ["Mindy", "", "Mindy"],
  ])("%j + %j -> %j", (first, last, want) => {
    expect(joinName(first, last)).toBe(want);
  });

  it("no screen builds full_name from the two boxes by hand", () => {
    const screens = trackedFiles("src").filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/"));
    expect(screens.length).toBeGreaterThan(500);
    const handJoined = screens.filter((f) => /`\$\{firstName\.trim\(\)\} \$\{lastName\.trim\(\)\}`/.test(blankComments(readFileSync(join(ROOT, f), "utf8"))));
    expect(handJoined).toEqual([]);
    const users = ["src/pages/auth/Signup.tsx", "src/pages/auth/completeProfile/saveCompletedProfile.ts", "src/pages/profile/Profile.tsx"];
    for (const f of users) expect(blankComments(readFileSync(join(ROOT, f), "utf8")), f).toMatch(/joinName\(firstName, lastName\)/);
  });
});
