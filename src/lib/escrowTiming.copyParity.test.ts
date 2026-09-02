import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  COPY_AUTO_RELEASE_HOURS,
  TOTAL_TO_PAYOUT_HOURS,
} from "../../supabase/functions/_shared/escrowTiming";

/**
 * escrowTiming ↔ user-facing copy.
 *
 * `escrowTiming.parity.test.ts` proves the CONSTANTS agree with each other and
 * with the cron. It cannot see the other half of the overnight failure mode:
 * a screen that RESTATES the window as a literal ("72 hours" beside a live
 * 48-hour countdown) instead of deriving it. This file closes that half —
 * it walks the whole of `src/` and holds the inventory of hardcoded
 * escrow/dispute/revision hour literals to a fixed, justified list, and pins
 * each surviving literal to the source of truth it is supposed to echo.
 *
 * Two ways this fails, both of them the bug we're guarding:
 *   1. Someone types a new "N hours" into completion / auto-release / dispute /
 *      revision copy → the inventory grows and the test names the file.
 *   2. A window MOVES (the constant or the SQL interval changes) → the pinned
 *      literals no longer match and the test names the stale sentence.
 */

const repoFile = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

/** Every non-test TS/TSX file under src/, straight from git (no stray builds). */
function sourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "src"], { cwd: process.cwd(), encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f))
    // `git ls-files` reports what git TRACKS, which still includes a file
    // deleted in the working tree but not yet staged. This test reads the
    // working tree, so a pending deletion would blow it up with ENOENT
    // before a single assertion ran — a red suite caused purely by the order
    // someone happened to stage things in.
    .filter((f) => existsSync(resolve(process.cwd(), f)));
}

/** Does this line talk about the escrow/dispute/revision clock? */
const CLOCK_CONTEXT =
  /auto-?releas|auto-?complet|payment (?:is )?(?:held|releas)|releases to the helpr|confirm or (?:request|dispute)|revision|dispute/i;
const HOUR_LITERAL = /(\d+)[ –-]?hours?\b/gi;

interface Hit {
  file: string;
  numbers: number[];
  text: string;
}

/**
 * Strip `/* … *\/` blocks, keeping line count so reported positions stay true.
 *
 * The line-leading test below (`/^\s*(\/\/|\*|\/\*)/`) only catches a block
 * comment's FIRST line and any continuation line a author happened to start
 * with `*`. A JSX block comment written without the `*` gutter — which is the
 * house style in `CommunitySection.tsx` — has interior lines that begin with a
 * plain word, so every one of them was scanned as if it were shipping copy. A
 * comment explaining "this used to say 12 hours" would therefore be counted as
 * a 12-hour promise and inflate the inventory, and the fix a reader would reach
 * for is to grow EXPECTED — quietly widening the allowance for real literals.
 *
 * Deliberately NOT the obvious `/\/\*[\s\S]*?\*\//g`. That version deleted two
 * real hits: `DisputeDialog.tsx:302` carries `accept="image/*"`, whose `/*`
 * opens a comment the stripper then ran to the next genuine block-comment
 * terminator thirty lines later — taking the file's actual 72-hour policy bullets
 * with it and shrinking
 * the inventory to a smaller, greener, wrong number. A comment stripper that
 * eats copy is the same failure this file exists to catch, pointed inward. So
 * only two unambiguous openers count: a JSX comment (brace, then slash-star), and
 * a block comment
 * that begins a line. Neither can occur inside a JSX attribute string.
 */
const stripComments = (text: string) =>
  text
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, (m) => m.replace(/[^\n]/g, ""))
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, (m) => m.replace(/[^\n]/g, ""))
    // Line comments too. The `[^:]` guard keeps `https://` out of it.
    //
    // Needed because a block comment recording what a sentence USED to say is
    // not always a block comment for long: the note under the one-sided
    // confirmation callout quoted a six-field cron expression, whose asterisk-
    // slash closed the comment early and broke the whole file's parse, so it
    // was converted to `//` lines. The quoted false claim then walked straight
    // back into this scan as if it were shipping copy.
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function scanHardcodedHours(): Hit[] {
  const hits: Hit[] = [];
  for (const file of sourceFiles()) {
    stripComments(repoFile(file))
      .split("\n")
      .forEach((line) => {
        // Skip comment lines — prose ABOUT the rule isn't shown to anyone.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (!CLOCK_CONTEXT.test(line)) return;
        const matches = [...line.matchAll(HOUR_LITERAL)];
        if (matches.length === 0) return;
        hits.push({
          file,
          numbers: matches.map((m) => Number(m[1])),
          text: line.trim(),
        });
      });
  }
  return hits;
}

/**
 * The justified inventory. `kind` records WHICH source of truth the literal is
 * echoing, so the assertions below can pin it there.
 *
 *   escrow  — the one-sided-completion window. A CONSTANT exists
 *             (COPY_AUTO_RELEASE_HOURS / PAYOUT_HOLD_HOURS /
 *             TOTAL_TO_PAYOUT_HOURS) so NOTHING may be on this list under this
 *             kind: every escrow site interpolates, and the test below asserts
 *             the derivation rather than pinning a literal.
 *   dispute — the formal dispute / revision window. Enforced in SQL as
 *             `interval '72 hours'`; there is NO TS constant to derive from.
 *   remind  — the reminder DELAY run by payment-confirm-reminder. Its
 *             `REMIND_AFTER_HOURS` lives inside an edge function with no
 *             export, so copy cannot import it; this test reads the function's
 *             source instead.
 */
const EXPECTED: Array<{ file: string; kind: "escrow" | "dispute" | "remind"; count: number }> = [
  { file: "src/components/DisputeDialog.tsx", kind: "dispute", count: 2 },
  { file: "src/components/activity/postedJobCard/PostedJobActions.tsx", kind: "dispute", count: 1 },
  // The Help Center's remaining literal is the 72h DISPUTE window, not the
  // escrow clock. Its escrow answer used to be here under kind "escrow" with
  // the numbers 24/24 hand-typed; it now interpolates COPY_AUTO_RELEASE_HOURS
  // and PAYOUT_HOLD_HOURS, so it produces no literal at all and the
  // derivation test below is what guards it.
  { file: "src/pages/helpCenter/helpCenterContent.ts", kind: "dispute", count: 1 },
  { file: "src/pages/legal/CommunitySection.tsx", kind: "dispute", count: 1 },
  { file: "src/pages/legal/CommunitySection.tsx", kind: "remind", count: 1 },
];

describe("escrow/dispute/revision windows — copy must not restate the clock", () => {
  const hits = scanHardcodedHours();

  it("no NEW hardcoded hour literal appears in completion/dispute/revision copy", () => {
    const expectedCount = EXPECTED.reduce((n, e) => n + e.count, 0);
    const inventory = hits.map((h) => `${h.file} → "${h.text.slice(0, 110)}"`).sort();
    expect(
      hits.length,
      `the hardcoded-hours inventory changed (${hits.length} vs ${expectedCount} expected).\n` +
        `Every line below restates a window instead of deriving it from ` +
        `supabase/functions/_shared/escrowTiming.ts. If you added one, interpolate the ` +
        `constant instead; if you removed one, shrink EXPECTED here.\n  ` +
        inventory.join("\n  "),
    ).toBe(expectedCount);

    // PER-FILE counts, not just per-file presence.
    //
    // The old loop only asked "is this file still somewhere in the inventory?".
    // Two files could trade a literal — one gains a hardcoded window, another
    // drops one — and the total plus the presence set would both still hold,
    // so a NEW promise could enter the app under a green test. Counting per
    // file is what makes the inventory an inventory.
    const perFile = new Map<string, number>();
    for (const h of hits) perFile.set(h.file, (perFile.get(h.file) ?? 0) + h.numbers.length);
    const expectedPerFile = new Map<string, number>();
    for (const e of EXPECTED) {
      expectedPerFile.set(e.file, (expectedPerFile.get(e.file) ?? 0) + e.count);
    }
    for (const [file, want] of expectedPerFile) {
      expect(
        perFile.get(file) ?? 0,
        `${file} states ${perFile.get(file) ?? 0} hardcoded window(s); EXPECTED says ${want}. ` +
          `Lines:\n  ` +
          hits.filter((h) => h.file === file).map((h) => h.text.slice(0, 120)).join("\n  "),
      ).toBe(want);
    }
  });

  it("the Help Center DERIVES the escrow clock instead of restating it", () => {
    // WAS: a pin on the literal pair the Help Center hand-typed, with a FINDING
    // note saying it should interpolate. It has now been interpolated, so the
    // pin has nothing left to compare and is replaced by the assertion that
    // actually holds the fix in place.
    //
    // This is strictly stronger than what it replaces. The old shape passed on
    // any literal that happened to equal the constant that day; this one passes
    // only on real derivation, so a regression to "24 hours" fails here even
    // while 24 is still the right answer — which is the only way the guard can
    // catch the drift BEFORE the constant moves rather than after.
    //
    // It also failed for a reason worth recording: it demanded the pair
    // [COPY_AUTO_RELEASE_HOURS, TOTAL_TO_PAYOUT_HOURS] = [24, 48], but the copy
    // states the second leg as a DELTA ("…about 24 hours after that"), matching
    // the push that auto-release-payment sends for the same event
    // (index.ts:302-303, 315-316). Both sentences were true; the guard could
    // only express one of the two true shapes, and "make the test pass" would
    // have meant putting a third number in front of users.
    const help = repoFile("src/pages/helpCenter/helpCenterContent.ts");
    expect(
      help,
      "helpCenterContent.ts no longer imports escrowTiming — its auto-release answer " +
        "has been hardcoded again, and is now free to drift from the cron and from the " +
        "push notification the same event sends",
    ).toMatch(/_shared\/escrowTiming/);
    for (const constant of ["COPY_AUTO_RELEASE_HOURS", "PAYOUT_HOLD_HOURS"]) {
      expect(
        help,
        `helpCenterContent.ts stopped interpolating ${constant}. The "What if a poster ` +
          `doesn't confirm completion?" answer states both legs of the schedule ` +
          `(${COPY_AUTO_RELEASE_HOURS}h to act, then a further hold; ` +
          `${TOTAL_TO_PAYOUT_HOURS}h in total to funds) and both must come from ` +
          `escrowTiming.ts.`,
      ).toContain(constant);
    }
  });

  it("the 72-hour dispute/revision literals equal the SQL interval that enforces them", () => {
    // There is no TS constant for these (FINDING — the dispute deadline and the
    // revision window are the only lifecycle clocks without one). Until there
    // is, read the SQL and pin the copy to it: the dispute card that said
    // "72 hours" beside a 48-hour countdown is exactly this drift.
    const disputeSql = repoFile(
      "supabase/migrations/20260330201452_be56defe-6968-411c-8c3d-167785e905be.sql",
    );
    const revisionSql = repoFile(
      "supabase/migrations/20260330203504_3ae6347b-55ac-48fa-b70c-bc9080813111.sql",
    );
    const disputeHours = Number(
      disputeSql.match(/dispute_deadline\s*:=[^;]*interval '(\d+) hours'/)![1],
    );
    const revisionHours = Number(
      revisionSql.match(/revision_deadline\s*:=[^;]*interval '(\d+) hours'/)![1],
    );
    expect(
      revisionHours,
      "the revision window and the dispute window are quoted as one number in copy " +
        `("each step has a 72-hour window") but SQL now has ${revisionHours}h vs ${disputeHours}h`,
    ).toBe(disputeHours);

    // THE FILTER THAT MADE THIS UNFAILABLE.
    //
    // The selector used to be `… && h.numbers.includes(72)`, so the loop only
    // examined lines that ALREADY said 72 — and then asserted they said 72.
    // Change a dispute sentence to "48-hour window" and the line stops matching
    // the filter, drops out of the loop, and is never graded: the guard passed
    // on precisely the drift it was written to catch. Proven by mutation on
    // 2026-08-31 — CommunitySection 72 → 48 left both suites green.
    //
    // Now every dispute-kind hit is graded on its own numbers, whatever they
    // are. The only exemption is the reminder delay, which legitimately appears
    // beside a dispute sentence and belongs to a different clock; it is named
    // by reading the cron rather than hardcoding 12 here, so the exemption
    // cannot quietly widen to cover a wrong number.
    const remindAfterHours = Number(
      repoFile("supabase/functions/payment-confirm-reminder/index.ts").match(
        /REMIND_AFTER_HOURS\s*=\s*(\d+)/,
      )?.[1] ?? NaN,
    );
    const disputeHits = hits.filter((h) =>
      EXPECTED.some((e) => e.file === h.file && e.kind === "dispute"),
    );
    expect(
      disputeHits.length,
      "no dispute-window literal is being graded at all — EXPECTED lists dispute-kind " +
        "files but the scan found none of them, so this whole block is inert",
    ).toBeGreaterThan(0);
    for (const hit of disputeHits) {
      for (const n of hit.numbers.filter((x) => x !== remindAfterHours)) {
        expect(
          n,
          `${hit.file} tells the user ${n} hours, but the trigger sets ` +
            `dispute_deadline / revision_deadline to interval '${disputeHours} hours'.\n  ${hit.text.slice(0, 140)}`,
        ).toBe(disputeHours);
      }
    }
  });

  it("the 12-hour reminder delay matches the cron that actually sends it", () => {
    const cron = repoFile("supabase/functions/payment-confirm-reminder/index.ts");

    // THE GUARD THAT GRADED THE WRONG NUMBER.
    //
    // This used to read the delay with `/(\d+) \* 60 \* 60 \* 1000/`. That
    // shape is gone from the file: the two real cutoffs are computed from
    // NAMED constants (`REMIND_AFTER_HOURS * 60 * 60 * 1000`,
    // `AUTO_COMPLETE_HOURS * 60 * 60 * 1000`), which `\d+` cannot match. The
    // first — and only — literal digit sequence in that shape belongs to the
    // SEVEN-DAY observability lookback, `7 * 24 * 60 * 60 * 1000`, so the regex
    // captured `24` out of a window that has nothing to do with reminders and
    // then failed the copy for disagreeing with it. Worse than blind: it named
    // a real file, a real number and a plausible reason, all wrong.
    //
    // Read the constant by name instead. If it is ever renamed or inlined, this
    // throws on the null assertion rather than silently latching onto the next
    // number that happens to fit the shape.
    const delayMatch = cron.match(/REMIND_AFTER_HOURS\s*=\s*(\d+)/);
    expect(
      delayMatch,
      "payment-confirm-reminder no longer declares REMIND_AFTER_HOURS — this guard is " +
        "reading nothing. Re-point it at whatever now holds the reminder delay BEFORE " +
        "trusting the copy that quotes it.",
    ).not.toBeNull();
    const remindAfterHours = Number(delayMatch![1]);

    const line = hits.find((h) => h.numbers.includes(remindAfterHours));
    expect(
      line,
      `no surface states the ${remindAfterHours}-hour reminder any more — update EXPECTED`,
    ).toBeDefined();
    expect(
      line!.numbers.filter((n) => n === remindAfterHours)[0],
      `Legal states a ${line!.numbers[0]}-hour reminder; payment-confirm-reminder sends it ` +
        `REMIND_AFTER_HOURS=${remindAfterHours}h after the helper marks done`,
    ).toBe(remindAfterHours);

    // The copy may describe ONE nudge, to the poster, and nothing else.
    //
    // It previously read "Both parties are notified every 12 hours", which was
    // false in both halves: the function inserts a single notification for
    // `job.customer_id` and stamps `payment_confirm_notif_sent` so the next tick
    // filters the row out. There is no cadence and the Helpr is never notified.
    // Asserting the SHAPE of the sentence, not just its number, is what stops
    // "every 12 hours" coming back with a correct 12 in it.
    expect(
      cron,
      "payment-confirm-reminder no longer notifies the poster (job.customer_id) — " +
        "the legal page names the poster specifically",
    ).toMatch(/user_id:\s*job\.customer_id/);
    expect(
      cron,
      "the `payment_confirm_notif_sent` idempotency stamp is gone, so the reminder may " +
        "now repeat. The legal page says 'a reminder', singular — re-check it.",
    ).toContain("payment_confirm_notif_sent");
    expect(
      /every\s+\d+\s*hours|notified every/i.test(
        // Comment-stripped: the note recording what this sentence USED to say
        // quotes the false cadence verbatim, and grading a file's own changelog
        // as if it were shipping copy is how a guard starts failing for reasons
        // that have nothing to do with the user.
        stripComments(repoFile("src/pages/legal/CommunitySection.tsx")),
      ),
      "CommunitySection describes a recurring reminder cadence. There isn't one — " +
        "payment-confirm-reminder sends exactly one notification per job.",
    ).toBe(false);
  });

  it("the surfaces that DO derive keep deriving (no silent re-hardcoding)", () => {
    // These five each state the auto-release window; all five interpolate.
    // Asserting the import (not the rendered number) is what makes a
    // regression-to-a-literal fail here rather than on someone's screen.
    //
    // Matched as a REAL import statement, not as the bare substring
    // `_shared/escrowTiming` anywhere in the file. The substring form passed on
    // a file that merely MENTIONED the module — a comment saying "this used to
    // come from _shared/escrowTiming" satisfied it perfectly while the code
    // below hardcoded 24. It also passed on `_shared/escrowTimingZ`, which is
    // how the mutation run first exposed it: the guard cannot tell an import
    // from a word.
    const IMPORTS_ESCROW_TIMING =
      /(?:^|\n)\s*import\s[\s\S]*?from\s+["'][^"']*_shared\/escrowTiming["']/;
    for (const file of [
      "src/pages/legal/CommunitySection.tsx",
      "src/pages/legal/TermsSection.tsx",
      "src/pages/PaymentSuccess.tsx",
      "src/components/activity/appliedJobCard/ActiveJobSection.tsx",
      "src/components/activity/postedJobCard/PostedJobActions.tsx",
    ]) {
      expect(
        repoFile(file),
        `${file} no longer imports escrowTiming — its auto-release copy has been hardcoded`,
      ).toMatch(IMPORTS_ESCROW_TIMING);
    }
  });

  it("the Help Center's own derivation is a real import too", () => {
    // Same substring-vs-import hazard as the block above, on the file this lane
    // actually changed. Kept as its own case so a failure names the Help Center
    // rather than being lost in a five-file loop.
    expect(
      repoFile("src/pages/helpCenter/helpCenterContent.ts"),
      "helpCenterContent.ts mentions escrowTiming but does not import it — the escrow " +
        "answer is hardcoded again",
    ).toMatch(/(?:^|\n)\s*import\s[\s\S]*?from\s+["'][^"']*_shared\/escrowTiming["']/);
  });
});
