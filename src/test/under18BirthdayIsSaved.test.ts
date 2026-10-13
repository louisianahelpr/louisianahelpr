/**
 * Q1586(c) CLASS GUARD, second half (owner, 2026-10-13: the sign-up 18+ box is
 * the requirement, so no new mandatory birthday; a birthday under 18 that a
 * member types is SAVED, never refused, and the grey-out starts).
 *
 * The class: every place a member can type their birthday. Each one used to
 * REFUSE a birthday under 18 ("You'll need to be 18 or older ..."), which left
 * profiles.date_of_birth empty, so member_under_18 said false, nothing greyed
 * out and the server let the honest minor apply and post (lh-authz-rls review
 * of 0f7786627, must-fix 1). The inventory is built from the source: every
 * non-test file under src/ and supabase/functions/ whose CODE (comments
 * blanked) writes date_of_birth, or renders a birthday picker, is one of the
 * EXACT list below, and none of them refuses an under-18 date.
 *
 * Behaviour: src/components/PhotoPrompt.test.tsx ("a birthday under 18 is
 * saved and stops the action"), and for the member's own save on the server,
 * src/test/pglite/under18CannotApplyOrPost.pglite.mjs S0-S4.
 *
 * @mutate src/pages/auth/CompleteProfile.tsx |     if (!dobValid) return fail("Add a real date of birth to continue."); |     if (!dobValid \|\| dobUnder18) return fail("You'll need to be 18 or older to join.");
 * @mutate supabase/functions/complete-signup/index.ts |       if (savedBirthdayUnder18(effectiveDob)) {\n        console.warn( |       if (savedBirthdayUnder18(effectiveDob)) {\n        return new Response(JSON.stringify({ error: "You must be at least 18 years old to use Helpr." }), { status: 403 });\n        console.warn(
 * @mutate src/components/PhotoPrompt.tsx |     d.setFullYear(d.getFullYear() - 120); |     d.setFullYear(d.getFullYear() - 120); void (() => { const x = new Date(); x.setFullYear(x.getFullYear() - 18); })();
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { walkSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

/** Every screen or function where a member's own birthday is typed or written. */
const BIRTHDAY_ENTRY = [
  "src/components/PhotoPrompt.tsx",
  "src/pages/auth/CompleteProfile.tsx",
  "supabase/functions/complete-signup/index.ts",
];
/** Writes date_of_birth but is not a member typing a birthday (with why). */
const NOT_ENTRY: Record<string, string> = {
  "src/integrations/supabase/types.ts": "generated column types, no write",
  "src/pages/auth/completeProfile/types.ts": "the CompleteProfile update's type, no write of its own",
  "src/pages/profile/Profile.tsx": "re-sends the birthday it loaded (no birthday field); the lock keeps an under-18 one",
};

// A refusal of an under-18 birthday, in any of the shapes these files used.
const REFUSAL = [
  /18 or older to (join|use)/i,
  /You must be at least 18 years old/i, // the no-birthday, no-box refusal ("You must confirm ...") stays
  /getFullYear\(\)\s*-\s*18\b/, // a picker capped at today - 18 years cannot take the honest answer
];

function inventory(): string[] {
  const found = new Set<string>();
  for (const dir of ["src", "supabase/functions"]) {
    for (const abs of walkSource([join(ROOT, dir)])) {
      const rel = relative(ROOT, abs);
      if (/\.(test|spec)\.[tj]sx?$/.test(rel) || rel.startsWith("src/test/")) continue;
      if (!/\.(ts|tsx)$/.test(rel)) continue;
      const src = blankComments(readFileSync(abs, "utf8"));
      const writesDob = /date_of_birth\s*:/.test(src) || /updateData\.date_of_birth\s*=/.test(src);
      const picksDob = /<DatePickerField[\s\S]{0,200}?id="(prompt-)?dob"/.test(src);
      if (writesDob || picksDob) found.add(rel);
    }
  }
  return [...found].sort();
}

describe("a birthday under 18 is saved, never refused (Q1586(c), owner 2026-10-13)", () => {
  const inv = inventory();

  it("finds the birthday entry points from the source (cannot pass vacuously)", () => {
    expect(inv.length).toBeGreaterThan(2);
  });

  it("every place that writes or picks a birthday is on the exact list", () => {
    const listed = [...BIRTHDAY_ENTRY, ...Object.keys(NOT_ENTRY)].sort();
    expect(inv.filter((f) => !listed.includes(f)), "new birthday entry point: add it to BIRTHDAY_ENTRY and make it save an under-18 birthday").toEqual([]);
    expect(listed.filter((f) => !inv.includes(f)), "a listed entry point no longer writes a birthday: drop it").toEqual([]);
  });

  it.each(BIRTHDAY_ENTRY)("%s does not refuse a birthday under 18", (rel) => {
    const src = code(rel);
    for (const re of REFUSAL) expect(src, `${rel} matches ${re}`).not.toMatch(re);
  });
});
