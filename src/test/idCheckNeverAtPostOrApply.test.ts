/**
 * CLASS GUARD (LEAD-SIGNUP-IDLINE, owner rule): the ID check never comes at
 * sign-up, applying or accepting. Owner decisions 10-30 ("ID check + $2 setup
 * fee"): once per account, when a member posts a job, gets hired, or lists,
 * buys or claims on Declutter, or takes a first payout. Posting IS one of those moments (lead
 * 10-31, B40), so a sentence naming the check at posting is not an offender.
 * The Home checklist side (no ID step, no ID check opened from Home) is
 * src/test/firstJobHomeTruth.test.ts.
 *
 * History: SignupPending said "Posting or accepting your first job adds a quick
 * identity check." and Help said posting or applying needs "a quick identity
 * check through Stripe" (both shown while the identity_check switch is on).
 *
 * Inventory from source: every non-test .ts/.tsx under src/, comments blanked.
 * A member-facing sentence (inside one string or JSX text run) that names an
 * identity / ID check AND applying, accepting or signing up is an offender,
 * unless it says the check is NOT asked there (no / not / never / without /
 * doesn't).
 *
 * @mutate src/pages/auth/SignupPending.tsx | " Once per account there's a quick ID check: when you post a job, get hired, or list, buy or claim on Declutter, or at your first payout." | " Signing up adds a quick ID check."
 * @mutate src/pages/info/helpCenter/helpCenterContent.ts | confirmed email. We ask for your ID once: when you post a job, when you're hired, or before your first payout, and on Declutter when you list, buy, claim a free item or take a delivery." | confirmed email and a quick identity check through Stripe."
 */
import { describe, it, expect } from "vitest";
import { resolve, relative } from "node:path";
import { walkSource, readSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const ID_CHECK = /\b(identity|ID) (check|verification)\b/;
const ASKED_AT = /\b(apply|applying|accept|accepting|sign(ing)? up)\b/i;
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

describe("no copy puts the ID check at sign-up, apply or accept", () => {
  it("reads the app's source (floor)", () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  it("lets posting be named as an ID moment (owner 10-30), still catches sign-up", () => {
    const pick = (s: string) => ID_CHECK.test(s) && ASKED_AT.test(s) && !NEGATED.test(s);
    expect(pick("Once per account there's a quick ID check: when you post a job or get hired.")).toBe(false);
    expect(pick("Signing up adds a quick ID check.")).toBe(true);
    expect(pick("Applying for a job needs an identity check.")).toBe(true);
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
