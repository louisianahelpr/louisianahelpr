/**
 * CLASS GUARD (LEAD-SIGNUP-IDLINE, owner rule): the ID check comes once per
 * person, at hire or first payout; never at sign-up, post, apply or accept.
 * SignupPending said "Posting or accepting your first job adds a quick identity
 * check." and Help said posting or applying needs "a quick identity check
 * through Stripe" (both shown while the identity_check switch is on).
 *
 * Inventory from source: every non-test .ts/.tsx under src/, comments blanked.
 * A member-facing sentence (inside one string or JSX text run) that names an
 * identity / ID check AND posting, applying, accepting or signing up is an
 * offender, unless it says the check is NOT asked there (no / not / never /
 * without / doesn't).
 *
 * @mutate src/pages/auth/SignupPending.tsx | " The first time you hire someone or get paid, there's a one-time quick identity check." | " Posting or accepting your first job adds a quick identity check."
 * @mutate src/pages/info/helpCenter/helpCenterContent.ts | confirmed email. The first time you hire someone or get paid, there's a one-time quick identity check through Stripe." | confirmed email and a quick identity check through Stripe."
 */
import { describe, it, expect } from "vitest";
import { resolve, relative } from "node:path";
import { walkSource, readSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const ID_CHECK = /\b(identity|ID) (check|verification)\b/;
const ASKED_AT = /\b(post|posting|apply|applying|accept|accepting|sign(ing)? up)\b/i;
const NEGATED = /\b(no|not|never|without|doesn't|does not|isn't)\b/i;

/** Sentences of member-facing text: string literals and JSX text, split on sentence ends. */
function sentences(code: string): string[] {
  const runs = [
    ...code.matchAll(/"((?:[^"\\\n]|\\.){12,})"/g),
    ...code.matchAll(/`((?:[^`\\]|\\.){12,})`/g),
    ...code.matchAll(/>\s*([^<>{}\n][^<>{}]{11,})</g),
  ].map((m) => m[1]);
  return runs.flatMap((r) => r.split(/(?<=[.!?])\s+/));
}

const files = walkSource([resolve(ROOT, "src")]).filter((f) => !/\.test\.tsx?$/.test(f) && !f.includes("/src/test/"));

describe("no copy puts the ID check at post, apply, accept or sign-up", () => {
  it("reads the app's source (floor)", () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  it("finds no such sentence", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readSource(f);
      if (!src || !ID_CHECK.test(src)) continue;
      for (const s of sentences(blankComments(src))) {
        if (ID_CHECK.test(s) && ASKED_AT.test(s) && !NEGATED.test(s)) offenders.push(`${relative(ROOT, f)}: ${s.trim().slice(0, 140)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
