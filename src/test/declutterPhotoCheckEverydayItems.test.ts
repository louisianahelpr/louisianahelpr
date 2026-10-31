/**
 * Owner 10-31 ~6:00 PM (OWNER-DECISIONS.md, "Declutter photo check"): the photo check held six everyday listings
 * for admin review. "no need for admin review they can be added. admin doesnt need to review stuff like that."
 * The check flags ONLY items that truly cannot be sold (the Terms' "What you can't sell" list), and only when the
 * item IS one; everyday items that only sound close are named as allowed.
 *
 * What this reads: the exact rule the model gets (supabase/functions/declutter-ai-draft/bannedRule.ts) and every
 * prompt in declutter-ai-draft/index.ts that carries it. What it cannot read: the model's own verdict on a photo
 * (no model call in tests); sanitize.ts still fails closed on a malformed answer (declutterAiDraftSanitize.test.ts).
 *
 * @mutate supabase/functions/declutter-ai-draft/bannedRule.ts | ONLY when the item clearly IS one of these | if the item may be any of these
 * @mutate supabase/functions/declutter-ai-draft/bannedRule.ts | set possibly_banned to false. Never flag | set possibly_banned to true. Never flag
 * @mutate supabase/functions/declutter-ai-draft/bannedRule.ts | (an acne cleanser, a face wash, sunscreen, lotion) | (a face wash, sunscreen, lotion)
 * @mutate supabase/functions/declutter-ai-draft/bannedRule.ts | (a USB body massager, a heating pad) | (a heating pad)
 * @mutate supabase/functions/declutter-ai-draft/bannedRule.ts | (a lash and brow lifting kit, a nail kit) | (a nail kit)
 * @mutate supabase/functions/declutter-ai-draft/bannedRule.ts | (a toy metal cannon, a toy sword, | (a toy sword,
 * @mutate supabase/functions/declutter-ai-draft/bannedRule.ts |  (a "Vera Bradley Style" duffel) |
 * @mutate supabase/functions/declutter-ai-draft/bannedRule.ts |  (a glass bottle with a stopper) |
 * @mutate supabase/functions/declutter-ai-draft/bannedRule.ts | or ammunition; alcohol; | alcohol;
 * @mutate supabase/functions/declutter-ai-draft/bannedRule.ts |  live animals; |
 * @mutate supabase/functions/declutter-ai-draft/index.ts | ${CATEGORY_RULE}\n${BANNED_RULE}` | ${CATEGORY_RULE}`
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BANNED_RULE } from "../../supabase/functions/declutter-ai-draft/bannedRule";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();
const rule = BANNED_RULE.replace(/\s+/g, " ");
const [notAllowed, allowed] = (() => {
  const cut = rule.indexOf("Everyday items are allowed");
  return [rule.slice(0, cut), rule.slice(cut)];
})();

/** The owner's six held listings, and the words in the ALLOWED part of the rule that decide each one. */
const OWNER_HELD_CASES: Array<[title: string, allowedBy: string]> = [
  ["Differin acne cleanser", "an acne cleanser"],
  ["USB body massager", "a USB body massager"],
  ["Lash & brow lifting kit", "a lash and brow lifting kit"],
  ["Toy metal cannon", "a toy metal cannon"],
  ['"Vera Bradley Style" duffel', 'a "Vera Bradley Style" duffel'],
  ["Glass bottle with stopper", "a glass bottle with a stopper"],
];

/** Items that truly cannot be sold, and the words in the NOT-ALLOWED part that flag each one. */
const MUST_FLAG_CASES: Array<[title: string, flaggedBy: string]> = [
  ["Glock 19 handgun", "a firearm or its parts"],
  ["Box of 9mm ammo", "ammunition"],
  ["Daisy BB rifle", "a BB, pellet or air gun"],
  ["Adderall 20 mg, half a bottle", "prescription medicine"],
  ["Unopened bottle of bourbon", "alcohol"],
  ["Elf Bar vape, 3 pack", "vapes or e-cigarettes"],
  ["Louis Vuitton Neverfull, 1:1 replica", "a counterfeit, meaning an item sold AS a brand it is not"],
  ["Recalled Fisher-Price Rock 'n Play sleeper", "a product under a recall"],
  ["Drop-side crib, 2008", "a crib made before mid-2011"],
  ["Graco infant car seat, used", "a used car seat"],
  ["Adult toy, new in box", "sexual or adult items"],
  ["Six laying hens", "live animals"],
];

describe("the Declutter photo check flags only what truly cannot be sold (owner 10-31)", () => {
  it("the rule is not the old fail-everything-unsure wording", () => {
    expect(rule).not.toMatch(/if you are not sure, set it to true/i);
    expect(rule).not.toMatch(/if the item may be any of these/i);
    expect(notAllowed).toMatch(/^Set possibly_banned to true, with a short reason, ONLY when the item clearly IS one of these/);
    expect(allowed).toMatch(/When nothing in the photos or the words shows the item is one of the not-allowed kinds, set possibly_banned to false\./);
    expect(allowed).toMatch(/Never flag an item only because of its category, its brand, or a word in its title\./);
  });

  it.each(OWNER_HELD_CASES)("the owner's held listing %s is named as allowed", (_title, allowedBy) => {
    expect(allowed).toContain(allowedBy);
    expect(notAllowed).not.toContain(allowedBy);
  });

  it.each(MUST_FLAG_CASES)("%s is still flagged", (_title, flaggedBy) => {
    expect(notAllowed).toContain(flaggedBy);
  });

  it("covers every kind the Terms say can't be sold (What you can't sell)", () => {
    const terms = readFileSync(join(ROOT, "src/pages/info/legal/TermsSection.tsx"), "utf8");
    const line = terms.match(/title="What you can't sell"[\s\S]*?<p>([^<]+)<\/p>/)?.[1] ?? "";
    expect(line.length).toBeGreaterThan(100);
    const kinds: Array<[RegExp, RegExp]> = [
      [/Weapons/, /a real weapon/], [/ammunition/, /ammunition/], [/alcohol/, /alcohol/],
      [/prescription and illegal drugs/, /prescription medicine or illegal drugs/], [/vapes/, /vapes/],
      [/any recalled product/, /a product under a recall/], [/cribs made before mid-2011/, /a crib made before mid-2011/],
      [/used car seats/, /a used car seat/], [/counterfeits/, /a counterfeit/], [/adult items/, /adult items/],
      [/live animals/, /live animals/], [/vehicles and boats/, /vehicles or boats/], [/real estate/, /real estate/],
    ];
    for (const [inTerms, inRule] of kinds) {
      expect(line, String(inTerms)).toMatch(inTerms);
      expect(notAllowed, String(inRule)).toMatch(inRule);
    }
  });

  it("every Declutter prompt that judges an item carries this rule, and no other banned list", () => {
    const src = blankComments(readFileSync(join(ROOT, "supabase/functions/declutter-ai-draft/index.ts"), "utf8"));
    expect(src).toMatch(/import \{ BANNED_RULE \} from "\.\/bannedRule\.ts";/);
    // ITEM_SYSTEM_PROMPT (draft, check, Wanted, Sell a bunch) and the moving-out room prompt.
    expect((src.match(/\$\{BANNED_RULE\}`/g) ?? []).length).toBe(2);
    expect(src).toMatch(/const ITEM_SYSTEM_PROMPT = `[^`]*\$\{BANNED_RULE\}`/);
    expect(src).not.toMatch(/cannot be sold:|If you are not sure, set it to true/);
  });
});
