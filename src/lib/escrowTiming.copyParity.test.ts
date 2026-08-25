import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));
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

function scanHardcodedHours(): Hit[] {
  const hits: Hit[] = [];
  for (const file of sourceFiles()) {
    repoFile(file)
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
 *   escrow  — the one-sided-completion window; a CONSTANT exists
 *             (COPY_AUTO_RELEASE_HOURS / TOTAL_TO_PAYOUT_HOURS) and this site
 *             should be interpolating it. Left hardcoded today — REPORTED, not
 *             papered over: see the `it(...)` note below.
 *   dispute — the formal dispute / revision window. Enforced in SQL as
 *             `interval '72 hours'`; there is NO TS constant to derive from.
 *   remind  — the reminder cadence run by payment-confirm-reminder.
 */
const EXPECTED: Array<{ file: string; kind: "escrow" | "dispute" | "remind"; count: number }> = [
  { file: "src/components/DisputeDialog.tsx", kind: "dispute", count: 2 },
  { file: "src/components/activity/postedJobCard/PostedJobActions.tsx", kind: "dispute", count: 1 },
  { file: "src/pages/helpCenter/helpCenterContent.ts", kind: "escrow", count: 1 },
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

    const files = new Set(hits.map((h) => h.file));
    for (const e of EXPECTED) {
      expect(files, `${e.file} left the inventory — update EXPECTED`).toContain(e.file);
    }
  });

  it("the auto-release literals still equal the constant they failed to interpolate", () => {
    // FINDING (reported, not fixed here): helpCenterContent.ts states the
    // auto-complete window and the time-to-funds as literals while
    // COPY_AUTO_RELEASE_HOURS / TOTAL_TO_PAYOUT_HOURS exist and every other
    // surface interpolates them. Pinning it means a future change to the
    // constant fails HERE, naming the stale Help Center answer, instead of
    // shipping a Help Center that contradicts the countdown on the card.
    const help = hits.find((h) => h.file === "src/pages/helpCenter/helpCenterContent.ts");
    expect(help, "the Help Center auto-release answer disappeared — update EXPECTED").toBeDefined();
    expect(
      help!.numbers,
      `Help Center says ${help!.numbers.join("/")} hours; escrowTiming says ` +
        `${COPY_AUTO_RELEASE_HOURS} (action window) / ${TOTAL_TO_PAYOUT_HOURS} (time to funds). ` +
        `Interpolate the constants in helpCenterContent.ts.`,
    ).toEqual([COPY_AUTO_RELEASE_HOURS, TOTAL_TO_PAYOUT_HOURS]);
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

    for (const hit of hits.filter(
      (h) => EXPECTED.some((e) => e.file === h.file && e.kind === "dispute") && h.numbers.includes(72),
    )) {
      for (const n of hit.numbers.filter((x) => x !== 12)) {
        expect(
          n,
          `${hit.file} tells the user ${n} hours, but the trigger sets ` +
            `dispute_deadline / revision_deadline to interval '${disputeHours} hours'.\n  ${hit.text.slice(0, 140)}`,
        ).toBe(disputeHours);
      }
    }
  });

  it("the 12-hour reminder cadence matches the cron that actually sends it", () => {
    const cron = repoFile("supabase/functions/payment-confirm-reminder/index.ts");
    const cronHours = Number(cron.match(/(\d+) \* 60 \* 60 \* 1000/)![1]);
    const line = hits.find((h) => h.numbers.includes(12));
    expect(line, "the 'notified every 12 hours' line vanished — update EXPECTED").toBeDefined();
    expect(
      line!.numbers.filter((n) => n === 12)[0],
      `Legal promises a reminder every 12 hours; payment-confirm-reminder runs on a ${cronHours}h window`,
    ).toBe(cronHours);
  });

  it("the surfaces that DO derive keep deriving (no silent re-hardcoding)", () => {
    // These five each state the auto-release window; all five interpolate.
    // Asserting the import (not the rendered number) is what makes a
    // regression-to-a-literal fail here rather than on someone's screen.
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
      ).toMatch(/_shared\/escrowTiming/);
    }
  });
});
