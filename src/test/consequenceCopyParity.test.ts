import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  NO_SHOW_LADDER_SENTENCE,
  CANCELLATION_LADDER_RUNGS,
} from "@/lib/reliabilityLadder";
import { REVIEW_SLA } from "@/lib/reviewSla";
import { URGENT_FEE_FLOOR_DOLLARS, URGENT_FEE_PRESETS } from "@/lib/moneyLimits";
import { BOOST_DURATION_HOURS } from "@/lib/productPrices";

/**
 * CONSEQUENCE COPY ↔ BACKEND PARITY — the general case.
 *
 * `reliabilityLadder.parity.test.ts` and `escrowTiming.copyParity.test.ts`
 * already do this for two surfaces, and they work. This file generalises the
 * pattern to the rest of the app, because the audits that missed ~20 real
 * defects missed them for a structural reason: a per-screen checklist reads a
 * screen and asks "does this look right?", and every sentence below LOOKS
 * right. The only way to see that it is false is to open the backend and check
 * — which is a cross-file question, so no per-screen pass can ask it.
 *
 * The failure mode is always the same shape. The app states a CONSEQUENCE — a
 * timeline, a fee, a credit, a ban, a count — and:
 *
 *   (a) the backing code once delivered it and no longer does (a "$10 Helpr
 *       credit" whose ledger was dropped; a "permanent ban" that is a 7-day
 *       review), or
 *   (b) nothing ever delivered it ("handled within 24 hours"), or
 *   (c) it IS delivered, but the number is retyped at the call site so the two
 *       can drift apart on the next edit.
 *
 * The fix for (c) is the `RELIABILITY_LADDER_SENTENCE` pattern: one exported
 * constant, every surface interpolates it, one parity test pins it to the SQL.
 * (a) and (b) cannot be fixed by a test — but they can be FOUND by one, and
 * every one of them is named below with the backend that was checked.
 *
 * NOTHING IN THIS FILE CHANGES ANY COPY. Where a statement is currently false,
 * that is recorded as a finding with the evidence, not quietly corrected.
 */

const ROOT = resolve(__dirname, "../..");
const repoFile = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

function sourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f))
    .filter((f) => existsSync(resolve(ROOT, f)));
}

/**
 * Comment stripper.
 *
 * The block half was `/\/\*[\s\S]*?\*\//g`, which is wrong on TSX and wrong in
 * the dangerous direction: `accept="image/*"` (DisputeDialog.tsx:302) is a JSX
 * attribute, not a comment opener, and that regex treated its `/*` as one and
 * deleted everything up to the next genuine block-comment terminator — thirty
 * lines of real, user-facing policy copy — from every scan that used this helper.
 * A stripper
 * that eats copy makes each scan below quietly narrower than it reads, which is
 * the exact failure class this file was written to catch.
 *
 * Only two unambiguous openers now count: a JSX comment (brace, then slash-star)
 * and a block
 * comment that begins a line. Neither can occur inside a JSX attribute string.
 * Newlines are preserved so line numbers in the reports below stay true.
 */
const stripComments = (t: string) =>
  t
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, (m) => m.replace(/[^\n]/g, ""))
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, (m) => m.replace(/[^\n]/g, ""))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * SQL comment stripper — for grading a migration's BODY, never its prose.
 *
 * Migrations here are heavily commented, and the comments quote the very
 * expressions the assertions look for. Two guards in this file were reading
 * those quotes and calling it evidence:
 *   - the DISTINCT-reporter guard matched `GUARD 3b, escalation on DISTINCT
 *     reporters;` in a header comment (line 43), not the aggregate;
 *   - the auto-ban guard matched `p_permanent_requires_review => true` in a
 *     header comment (20260831183302:21), so flipping the REAL call at :195 to
 *     `false` — a ladder that starts permanently banning people with no admin
 *     review — left both suites green. Confirmed by mutation, 2026-08-31.
 * A file's description of itself is the one thing that cannot go stale in step
 * with the file.
 */
const sqlBody = (sql: string) =>
  sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

// ===========================================================================
// 1 — NO_SHOW_LADDER_SENTENCE ↔ report_helper_no_show (SQL)
//
// The agent that wrote migration 20260831183302 and the new constant flagged,
// explicitly, that no parity test guarded either. This closes that gap.
// ===========================================================================

describe("no-show ladder — NO_SHOW_LADDER_SENTENCE ↔ report_helper_no_show (SQL)", () => {
  /**
   * The migration that holds the LIVE definition. If a later migration
   * redefines `report_helper_no_show`, point this at it — otherwise this whole
   * block goes quietly blind, asserting against a superseded file. (Same
   * caveat, same wording, as reliabilityLadder.parity.test.ts's LADDER_SQL.)
   */
  const SQL = repoFile(
    "supabase/migrations/20260831183302_no_show_ladder_uses_shared_review_rung.sql",
  );

  it("the RPC still delegates to the shared reviewable core", () => {
    expect(
      SQL,
      "report_helper_no_show no longer calls apply_consequence_ladder — it has gone " +
        "back to hand-writing its own rungs, which is how it ended up auto-banning",
    ).toContain("apply_consequence_ladder");
    expect(
      sqlBody(SQL).match(/p_permanent_requires_review\s*=>\s*true/),
      "the no-show ladder would now permanently ban a Helpr with NO admin review, off " +
        "one counterparty tapping a button on an event the platform never verifies. " +
        "NO_SHOW_LADDER_SENTENCE promises 'an admin decides' — that promise would be false.",
    ).not.toBeNull();
    expect(
      SQL,
      "the top rung no longer files a 'pending_ban_review' violation, so the case will " +
        "never reach the Ban Review queue the sentence promises",
    ).toContain("pending_ban_review");
  });

  it("the sentence describes the two rungs the RPC actually applies", () => {
    const s = NO_SHOW_LADDER_SENTENCE.toLowerCase();
    expect(
      s,
      `"${NO_SHOW_LADDER_SENTENCE}" must call the FIRST report a final warning ` +
        `(SQL rung 1 → 'warning' → ban_status 'final_warning')`,
    ).toMatch(/first[^,]*final warning/);
    expect(
      s,
      `"${NO_SHOW_LADDER_SENTENCE}" must say the SECOND report comes from a DIFFERENT ` +
        `poster — GUARD 3b counts DISTINCT reporters, so one poster acting alone can ` +
        `never reach the top rung, and a sentence that omits this reads as "report the ` +
        `same Helpr twice and they're gone"`,
    ).toMatch(/different poster/);
    expect(
      s,
      `"${NO_SHOW_LADDER_SENTENCE}" must state the 7-day restriction, not a ban`,
    ).toMatch(/7 days/);
    expect(
      s,
      `"${NO_SHOW_LADDER_SENTENCE}" must say an ADMIN decides — the RPC files a review, ` +
        `it does not ban`,
    ).toMatch(/admin/);
    expect(
      /permanently ban(?!.*admin)|automatic/.test(s),
      `"${NO_SHOW_LADDER_SENTENCE}" promises an automatic permanent ban the RPC no longer applies`,
    ).toBe(false);
  });

  it("the distinct-reporter guard the sentence leans on is still in the SQL", () => {
    // If GUARD 3b goes, "a second one from a different poster" becomes false and
    // one poster can restrict a Helpr alone.
    //
    // BLIND AS WRITTEN. The old matcher was `/DISTINCT[\s\S]{0,400}report/i`
    // against the RAW migration, and what it actually matched was line 43 —
    // `--   * GUARD 3a, one report per job; GUARD 3b, escalation on DISTINCT
    // reporters;` — a line in the file's header COMMENT. Delete the aggregate
    // from the function body and leave the header describing it, which is the
    // realistic way this regresses, and the guard still passed. It was
    // certifying a promise by reading a sentence about the promise.
    //
    // Strip SQL comments, then match the aggregate itself.
    const body = sqlBody(SQL);
    expect(
      body,
      "GUARD 3b (escalate on DISTINCT reporters) is gone from the FUNCTION BODY — " +
        "NO_SHOW_LADDER_SENTENCE's 'from a different poster' clause is now a lie, and " +
        "one poster can drive a Helpr to the top rung by themselves",
    ).toMatch(/count\s*\(\s*DISTINCT\s+reported_by\s*\)/i);
  });

  it("the 7 in the sentence is the 7 in the SQL", () => {
    const days = SQL.match(/p_suspension_days\s*=>\s*(\d+)/)?.[1];
    expect(days, "p_suspension_days is no longer passed to the ladder").toBeDefined();
    expect(
      NO_SHOW_LADDER_SENTENCE,
      `the sentence says 7 days; the RPC passes p_suspension_days => ${days}`,
    ).toContain(`${days} days`);
  });

  it("every surface that describes a no-show consequence READS the constant", () => {
    // Two surfaces render it today (the legal page and the report-no-show
    // confirm). A third that retypes it is the drift this test exists to stop.
    for (const file of [
      "src/pages/legal/CommunitySection.tsx",
      "src/components/activity/ActivityDialogs.tsx",
    ]) {
      expect(
        repoFile(file),
        `${file} no longer imports NO_SHOW_LADDER_SENTENCE — its no-show consequence ` +
          `copy has been hardcoded and can now drift from 20260831183302`,
      ).toContain("NO_SHOW_LADDER_SENTENCE");
    }
  });

  it("the client's own no-show notifications describe the rung the RPC reached", () => {
    // These strings are user-facing copy written in TS, keyed off the RPC's
    // action strings. A rename in SQL that isn't mirrored here shows the user
    // the WRONG consequence, silently.
    const handlers = repoFile("src/pages/activity/activityActions/useLifecycleHandlers.ts");
    expect(
      handlers,
      "useLifecycleHandlers no longer branches on 'pending_ban_review' — the second " +
        "no-show would be announced with the first-report warning copy",
    ).toContain('"pending_ban_review"');
    // The legacy 'permanent_ban' branch is DELIBERATE — see the migration's
    // "NO NEW RPC, so no PGRST202 deploy-lag window" note. It must stay until
    // the migration has been applied everywhere, and it must keep saying
    // "banned" (describing a real ban as "under review" is the worse lie).
    expect(
      handlers,
      "the legacy 'permanent_ban' branch was deleted. During the deploy-lag window " +
        "the old RPC can still return it, and without this branch a REAL permanent " +
        "ban would be announced as a 7-day review.",
    ).toContain('"permanent_ban"');
  });
});

// ===========================================================================
// 2 — one ladder, one statement of it
// ===========================================================================

describe("the strike ladder is stated ONCE", () => {
  /**
   * FINDING (reported, not fixed — no production file is touched by this lane).
   *
   * `reliabilityLadder.ts` exists precisely so the ladder is written down once.
   * Four surfaces state a strike ladder in full, and only ONE of them reads the
   * module:
   *
   *   src/pages/legal/CommunitySection.tsx:259-261  — hand-typed "Cancellation
   *       strikes (posters)" bullets, in a file that DOES import
   *       RELIABILITY_LADDER_RUNGS for a different section three screens up.
   *   src/components/CancellationDialog.tsx:346-358 — hand-typed "Strike System"
   *       block. Its own comment calls itself "the canonical copy for this
   *       ladder", which is the tell: two files both believe they are canonical.
   *   src/components/profile/WarningsTab.tsx:26,137-143 — a third hand-typed
   *       copy (STRIKE_LABELS + three hero strings).
   *
   * All three are TRUE against the SQL today. That is exactly why this is worth
   * a test and not a bug report: they were true the last time too, and then the
   * RPC moved and the copy did not, and "five strikes is a ban" shipped for
   * weeks. Three copies means the next RPC change has three chances to be missed.
   */
  const RESTATERS = [
    "src/components/CancellationDialog.tsx",
    "src/components/profile/WarningsTab.tsx",
    "src/pages/legal/CommunitySection.tsx",
  ];

  it("no surface restates the rungs instead of reading RELIABILITY_LADDER_RUNGS", () => {
    // "Nth strike" followed, within the same line, by a stated consequence is a
    // ladder restatement. Matching across the tag boundary matters: the JSX
    // shape is `<strong>1st strike:</strong> Written warning…`, so a matcher
    // that stops at `<` sees only the label and reports nothing — which is how
    // the first draft of this test found WarningsTab and missed the two
    // surfaces the owner actually reads.
    const RUNG_LABEL = /\b(1st|2nd|3rd|4th|first|second|third|fourth) strike\b/gi;
    const CONSEQUENCE =
      /written warning|final warning|restricted for|suspend|suspension|permanent(?:ly)? ban|admin reviews/i;
    const offenders: string[] = [];
    for (const file of RESTATERS) {
      const src = stripComments(repoFile(file));
      src.split("\n").forEach((line, i) => {
        // A line that INTERPOLATES the shared module is the fix, not the defect.
        if (/RELIABILITY_LADDER_(RUNGS|SENTENCE)/.test(line)) return;
        for (const m of line.matchAll(RUNG_LABEL)) {
          const after = line.slice(m.index! + m[0].length, m.index! + m[0].length + 140);
          if (!CONSEQUENCE.test(after)) continue; // "Strike 2 of 3" reports state, it doesn't restate the ladder
          if (offenders.some((o) => o.startsWith(`${file}:${i + 1} `))) continue; // one report per line
          offenders.push(
            `${file}:${i + 1} — "${m[0]}${after.replace(/<[^>]*>/g, "").trim().slice(0, 60)}…" ` +
              `is a hand-typed rung. Render RELIABILITY_LADDER_RUNGS (src/lib/reliabilityLadder.ts) ` +
              `so this sentence cannot survive the next change to apply_consequence_ladder.`,
          );
        }
      });
    }
    expect(
      offenders,
      `the ladder is written down in ${new Set(offenders.map((o) => o.split(":")[0])).size} ` +
        `more places than reliabilityLadder.ts:\n  ` +
        offenders.join("\n  "),
    ).toEqual([]);
  });
  it("no surface claims a ban lands automatically at a fixed strike count", () => {
    // THE RESTATEMENT GUARD ABOVE HAS A SHAPE IT CANNOT SEE, and a live defect
    // walked through it.
    //
    // `CommunitySection.tsx` opened with the TL;DR bullet "Three strikes =
    // ban." — the first sentence a restricted user reads, in a binding
    // document, and false. No ladder in the app bans anyone: all four call
    // `apply_consequence_ladder` with `p_permanent_requires_review => true`
    // (20260829030000:298,373,466; 20260831183302), which turns the 'permanent'
    // effect into a 7-day restriction plus a `pending_ban_review` row an admin
    // resolves. The rung lists three screens further down said so correctly.
    //
    // The guard above missed it because its detector needs an ordinal token
    // ("1st strike", "third strike") and a consequence WITHIN THE SAME LINE.
    // "Three strikes = ban" is a cardinal, in a summary, and names the
    // consequence with a bare noun. Every condition failed, so the sentence was
    // invisible — a restatement guard that only sees restatements written in
    // one particular grammar.
    //
    // This assertion grades the CLAIM rather than the grammar: nowhere in
    // user-facing copy may a strike count be equated with a ban, in any
    // phrasing, while the SQL requires a human.
    const requiresReview = sqlBody(
      repoFile("supabase/migrations/20260829030000_consolidate_consequence_ladders.sql"),
    ).match(/p_permanent_requires_review\s*=>\s*(true|false)/g) ?? [];
    expect(
      requiresReview.length,
      "apply_consequence_ladder's callers no longer pass p_permanent_requires_review — " +
        "re-derive every ban claim in the app before trusting this assertion",
    ).toBeGreaterThan(0);
    const noShowReview = sqlBody(
      repoFile(
        "supabase/migrations/20260831183302_no_show_ladder_uses_shared_review_rung.sql",
      ),
    ).match(/p_permanent_requires_review\s*=>\s*(true|false)/g) ?? [];
    expect(
      [...requiresReview, ...noShowReview].every((m) => /true/.test(m)),
      "a ladder now bans WITHOUT admin review (" + requiresReview.join(", ") + "). Every " +
        "surface promising 'a permanent ban is never automatic' is now false — fix the " +
        "copy, or the ladder.",
    ).toBe(true);

    // `\d|one..five|a` strikes → ban/banned/suspended-forever, in any order.
    const ABSOLUTE_BAN =
      /\b(?:\d+|one|two|three|four|five)\s+strikes?\b[^.!?\n]{0,40}\b(?:=|means?|is|→|->|and\s+you(?:'re| are))?\s*[^.!?\n]{0,30}\bbann?(?:ed|ing)?\b/i;
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      stripComments(repoFile(file))
        .split("\n")
        .forEach((line, i) => {
          if (/RELIABILITY_LADDER_|CANCELLATION_LADDER_|NO_SHOW_LADDER_/.test(line)) return;
          const m = line.match(ABSOLUTE_BAN);
          if (m) offenders.push(`${file}:${i + 1} — "${m[0].trim().slice(0, 90)}"`);
        });
    }
    expect(
      offenders,
      "these lines equate a strike count with a ban, but every ladder passes " +
        "p_permanent_requires_review => true — the top rung is a 7-day restriction and " +
        "an admin decision, never an automatic ban:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("the ladder's reassurance survives the move into the constant", () => {
    // This used to grep CancellationDialog for "a permanent ban is never
    // automatic". That sentence now lives in CANCELLATION_LADDER_RUNGS, which
    // is the whole point — so the assertion follows it rather than the file.
    // What must never regress is that a person decides: "restricted for 7 days"
    // with no mention of a human reads as a countdown to an automatic ban, and
    // it is the sentence a restricted user quotes back at us.
    expect(
      CANCELLATION_LADDER_RUNGS.join(" "),
      "the cancellation ladder stopped saying an admin decides the outcome",
    ).toMatch(/admin reviews|admin decides|never automatic/i);
    for (const [name, file] of [
      ["CancellationDialog", "src/components/CancellationDialog.tsx"],
      ["WarningsTab", "src/components/profile/WarningsTab.tsx"],
      ["CommunitySection", "src/pages/legal/CommunitySection.tsx"],
    ] as const) {
      expect(
        repoFile(file),
        `${name} stopped reading CANCELLATION_LADDER_RUNGS — it is stating the ` +
          `poster-cancellation ladder from memory again`,
      ).toMatch(/CANCELLATION_LADDER_RUNGS/);
    }
  });

  it("WarningsTab renders the rung the ladder ACTUALLY writes", () => {
    // FINDING — LIVE DEFECT, reported not fixed (the file is owned by another lane).
    //
    // All four ladders write `action_taken = 'pending_ban_review'` on their top
    // rung (20260829030000 + 20260831183302). WarningsTab.tsx classifies a
    // violation row by `action_taken` and knows four values —
    // 'warning', 'final_warning', 'temp_ban' (+ two dead legacy spellings) and
    // 'permanent_ban'. It has NO branch for 'pending_ban_review'.
    //
    // Consequence: a user standing on the top rung — restricted for 7 days,
    // with a ban decision pending — opens Warnings & Strikes and reads
    // "Strike 2 of 3 — final warning", because the pending_ban_review row
    // matches neither `strikeCount` nor `hasSuspension` nor `hasBan` and is
    // counted as nothing at all. This is `pending_approval` falling through a
    // switch, a third time, on a trust screen.
    //
    // It is also why `hasBan` can no longer fire from a ladder: nothing writes
    // 'permanent_ban' any more, so the "Account banned" hero is now reachable
    // only from a legacy row.
    const src = repoFile("src/components/profile/WarningsTab.tsx");
    expect(
      src,
      "WarningsTab has no branch for action_taken='pending_ban_review' — the value " +
        "EVERY ladder writes on its top rung. A restricted user pending a ban decision " +
        "is shown 'final warning' instead. Add the rung (and see the assertNever " +
        "groundwork in src/test/jobStatusExhaustive.test.ts).",
    ).toContain("pending_ban_review");
  });
});

// ===========================================================================
// 3 — turnaround promises
// ===========================================================================

describe("review-turnaround promises come from reviewSla", () => {
  /**
   * `src/lib/reviewSla.ts` exists because /account-pending stated the SLA twice
   * with two different numbers. The module fixed that screen; the same defect
   * is alive in three OTHER places, each with its own hand-typed number:
   *
   *   "usually within 24 hours"        src/components/IDVPromptDialog.tsx (manual ID review)
   *   "manually within 24 hours"       src/pages/legal/TermsSection.tsx   (manual ID review)
   *   "we review within one business day"
   *                                    src/components/profile/CredentialsTab.tsx
   * against REVIEW_SLA = "under 2 hours". FIXED SINCE: a fourth,
   * "reviews all reports within 24 hours" in
   * src/pages/helpCenter/helpCenterContent.ts, was removed outright rather than
   * renumbered — nothing in the product measured, tracked or escalated an
   * unread report, so no number would have been true (see the "delivered by
   * nothing" test below, now inverted to hold that removal in place). Three
   * numbers remain for "how long until a human looks at this". FINDING, not
   * fixed here.
   */
  const CLAIM =
    /(?:with)in\s+(?:about\s+)?(?:one|two|\d+(?:\s*[–-]\s*\d+)?)\s*(?:business\s+)?(?:hour|day)s?/gi;
  const SURFACE = /review|approv|verif|report|respon/i;

  it("no NEW hand-typed review turnaround appears anywhere in src/", () => {
    /**
     * The justified inventory as of this file's authorship. Every entry is a
     * FINDING, not an approval: four surfaces, four different numbers, for the
     * single question "how long until a human looks at this".
     */
    const KNOWN: Record<string, string> = {
      "src/components/IDVPromptDialog.tsx":
        "manual ID review — 'usually within 24 hours'; REVIEW_SLA says 'under 2 hours'",
      "src/pages/legal/TermsSection.tsx":
        "manual ID review — 'within 24 hours'; the SAME fact as IDVPromptDialog, retyped, " +
        "and this one is binding copy in a legal document",
      "src/components/profile/CredentialsTab.tsx":
        "credential re-upload — 'within one business day'; a third, different number",
      // src/pages/helpCenter/helpCenterContent.ts was the fourth entry. Its
      // "reviews all reports within 24 hours" is GONE, not renumbered, so the
      // file correctly dropped out of `hits` and the `stale` assertion below
      // started failing — which is the inventory doing its job. Shrinking KNOWN
      // is the documented response; the removal is pinned by the inverted
      // "delivered by nothing" test below so it cannot creep back.
    };

    const hits = new Map<string, string[]>();
    for (const file of sourceFiles()) {
      const src = stripComments(repoFile(file));
      src.split("\n").forEach((line) => {
        if (!SURFACE.test(line)) return;
        const found = [...line.matchAll(CLAIM)].map((m) => m[0]);
        if (found.length) hits.set(file, [...(hits.get(file) ?? []), ...found]);
      });
    }

    const unexpected = [...hits.keys()]
      .filter((f) => !(f in KNOWN))
      .map(
        (f) =>
          `${f} — states a turnaround (${hits.get(f)!.join(", ")}) as a literal. ` +
            `Interpolate REVIEW_SLA from src/lib/reviewSla.ts, or add an entry to KNOWN here ` +
            `saying which backend delivers this specific window.`,
      );
    expect(
      unexpected,
      "NEW hand-typed turnaround promises:\n  " + unexpected.join("\n  "),
    ).toEqual([]);

    // And the known ones must not disappear silently — if one is fixed, shrink
    // KNOWN, so the list stays an accurate account of what is still outstanding.
    const stale = Object.keys(KNOWN).filter((f) => !hits.has(f));
    expect(
      stale,
      "these files no longer state a turnaround — remove them from KNOWN so the " +
        "inventory keeps meaning something:\n  " + stale.join("\n  "),
    ).toEqual([]);
  });

  it("the two payout-window sentences state the SAME window", () => {
    // FINDING: "Standard payouts are free and take 1–2 business days"
    // (InstantPayoutDialog) vs "Payouts land within 2 business days of a
    // completed job" (PayoutHistory). Same fact, two sentences, no constant.
    // Neither is derived from anything, so nothing keeps them together.
    // FIXED: both now interpolate STANDARD_PAYOUT_WINDOW from
    // src/lib/payoutTiming.ts, so the assertion changed shape with them — it
    // asserts DERIVATION rather than scanning for matching literals, because a
    // literal scan cannot tell "both say 2" from "both stopped saying it".
    const a = repoFile("src/components/InstantPayoutDialog.tsx");
    const b = repoFile("src/components/profile/earningsTab/PayoutHistory.tsx");
    for (const [name, src] of [["InstantPayoutDialog", a], ["PayoutHistory", b]] as const) {
      expect(
        src,
        `${name} states the standard payout window without importing it. Both screens ` +
          `describe one fact and used to give two different answers ("1–2 business days" ` +
          `vs "within 2 business days"); STANDARD_PAYOUT_WINDOW exists so they cannot ` +
          `drift again. Interpolate it rather than retyping the number.`,
      ).toMatch(/STANDARD_PAYOUT_WINDOW/);
    }
    // And no hand-typed "N business days" may creep back into either file.
    const literal = /\d\s*(?:[–-]\s*\d\s*)?business days/;
    expect(literal.test(a) || literal.test(b), "a hand-typed business-day count is back").toBe(false);
  });

  it("REVIEW_SLA is still the shared statement it claims to be", () => {
    expect(
      repoFile("src/pages/AccountPending.tsx"),
      "AccountPending stopped importing REVIEW_SLA — that screen is the reason the " +
        "module exists (it once stated the SLA twice with two different numbers)",
    ).toContain("REVIEW_SLA");
    expect(REVIEW_SLA, "REVIEW_SLA is empty").toBeTruthy();
  });
});

// ===========================================================================
// 4 — money figures the UI names
// ===========================================================================

describe("money the UI names is the money the backend moves", () => {
  it("the referral credit the copy promises is the amount the trigger mints", () => {
    // TRACEABLE, and TRUE today: check_referral_bonus inserts amount = 5 into
    // referral_credits for both sides. But the client retypes "$5" in five
    // places with no constant, so the next change to the trigger has five
    // chances to be missed — the exact shape of the "$10 Helpr credit whose
    // ledger was dropped" defect.
    const sql = repoFile("supabase/migrations/20260823010000_close_verified_money_holes.sql");
    const amounts = [...sql.matchAll(/INSERT INTO public\.referral_credits[\s\S]{0,200}?VALUES\s*\([^,]+,\s*(\d+)/g)]
      .map((m) => Number(m[1]));
    expect(
      amounts.length,
      "check_referral_bonus no longer inserts referral_credits rows here — the live " +
        "definition moved to a later migration and this guard is blind",
    ).toBeGreaterThan(0);
    expect(
      new Set(amounts).size,
      `the trigger mints ${[...new Set(amounts)].join("/")} credits — the UI says one number`,
    ).toBe(1);
    const backend = amounts[0];

    for (const file of [
      "src/components/ReferralSection.tsx",
      "src/components/profile/ReferralExtras.tsx",
    ]) {
      const src = stripComments(repoFile(file));
      const quoted = [...src.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
      const wrong = quoted.filter((n) => n !== backend && n !== backend * 5);
      expect(
        wrong,
        `${file} promises $${wrong.join("/$")} but check_referral_bonus mints $${backend}. ` +
          `Export the amount from a constant module and interpolate it in both places.`,
      ).toEqual([]);
    }
  });

  it("the referral cap that IS enforced in SQL is the ceiling the copy states", () => {
    // This test used to assert the OPPOSITE — "there is NO cap of five and no
    // $25 ceiling in any migration", concluding "a user who refers ten people
    // is credited $50". That finding note was wrong, and the test passed anyway
    // because its detector could not see the cap it was looking for.
    //
    // The cap has existed since `enforce_referral_cap` (20260403151012), a
    // BEFORE INSERT trigger on referral_credits. The old regex required
    // `count(*) >= 5` as one adjacent expression; the real function is
    //     SELECT count(*) INTO credit_count ...
    //     IF credit_count >= 5 THEN ... RETURN NULL;
    // so the two halves are on different lines and never matched. A guard that
    // has never fired is not evidence — this one was structurally blind.
    //
    // Executed against the live function in PGlite (2026-08-31): a referrer
    // completing eight referred users' first jobs ended on exactly 5 credits =
    // $25, with the 6th+ silently suppressed and a `referral_abuse` fraud flag
    // raised each time. So the "$25 max" half of the copy is TRUE and enforced.
    //
    // The "5 friends" half is NOT true for everyone: the cap counts
    // `first_job_bonus` as well as `referrer_bonus`, so a user who themselves
    // arrived via a referral link can only ever be paid for FOUR friends. The
    // copy therefore states the dollar ceiling, which holds for every user.
    const migrations = execFileSync("git", ["ls-files", "supabase/migrations"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim().split("\n");
    const capped = migrations.filter((m) => {
      const sql = repoFile(m);
      if (!/referral/i.test(sql)) return false;
      // Match the real shape (count into a variable, compared later) as well as
      // the inline form, so this cannot go blind the same way twice.
      return /enforce_referral_cap/i.test(sql)
        || /count\(\*\)\s*[<>]=?\s*5\b/i.test(sql)
        || /\b\w*count\w*\s*>=\s*5\b/i.test(sql)
        || /max_referrals|referral_limit/i.test(sql);
    });
    expect(
      capped,
      "the referral cap disappeared from SQL. ReferralSection.tsx tells users they " +
        "can earn 'up to $25 in referral credits'; if enforce_referral_cap is gone, " +
        "that ceiling is now a promise nothing keeps and the copy is a lie.",
    ).not.toEqual([]);

    // The stated ceiling must equal cap x per-referral amount.
    const capSql = repoFile(
      "supabase/migrations/20260403151012_d3d3f353-1a28-453d-9d90-fe4e6cb6f143.sql",
    );
    const capN = Number(capSql.match(/credit_count\s*>=\s*(\d+)/)![1]);
    const copy = stripComments(repoFile("src/components/ReferralSection.tsx"));
    const ceiling = Number(copy.match(/up to \$(\d+) in referral credits/i)![1]);
    expect(
      ceiling,
      `ReferralSection.tsx promises a $${ceiling} ceiling but enforce_referral_cap ` +
        `allows ${capN} credits of $5 = $${capN * 5}.`,
    ).toBe(capN * 5);
  });

  it("the urgent-fee floor the form states is the floor moneyLimits defines", () => {
    // FINDING: src/lib/moneyLimits.ts says, in its own header, that "every
    // screen that names one of these numbers MUST import from here — that is
    // how the '$5 min' vs '$10 min' drift happened". useJobSubmit.ts obeys.
    // BudgetSection.tsx — the actual input form the user reads — has no
    // moneyLimits import at all and hand-types the floor AND all four presets.
    const src = repoFile("src/components/postjob/BudgetSection.tsx");
    expect(
      src,
      `BudgetSection.tsx hand-types the urgent-fee floor ($${URGENT_FEE_FLOOR_DOLLARS}) and the ` +
        `presets (${URGENT_FEE_PRESETS.join(", ")}) instead of importing them from ` +
        `@/lib/moneyLimits — the module whose entire stated purpose is to stop exactly ` +
        `this. It is the FORM: if it and the validator ever disagree, the user is told ` +
        `a minimum the submit path rejects.`,
    ).toMatch(/moneyLimits|URGENT_FEE_FLOOR_DOLLARS/);
  });

  it("the boost duration the toast quotes is the constant the dialog uses", () => {
    // JobBoostDialog imports BOOST_DURATION_HOURS. Dashboard.tsx states the same
    // fact in a success toast as a literal "24 hours".
    // WAS wrapped in `if (boostLine) { … }`, which is a guard that disarms
    // itself. Reword the toast to "for the next day", or move it to another
    // file, and `find` returns undefined — the body never runs, the test still
    // reports green, and the assertion that Dashboard's number tracks
    // BOOST_DURATION_HOURS silently stops existing. Nothing tells anyone.
    //
    // A conditional guard is only honest if the condition itself is asserted.
    // Either Dashboard states the duration (and it must equal the constant), or
    // it derives it (and there is nothing left to compare) — a third state,
    // "states it in a shape this test cannot read", must fail loudly.
    const dash = stripComments(repoFile("src/pages/Dashboard.tsx"));
    const boostLine = dash.split("\n").find((l) => /boost/i.test(l) && /\d+ hours/.test(l));
    const derives = /BOOST_DURATION_HOURS/.test(dash);
    expect(
      Boolean(boostLine) || derives,
      "Dashboard.tsx no longer states the boost duration in a form this test can read: " +
        "no `N hours` literal on a boost line, and no BOOST_DURATION_HOURS import. Either " +
        "it stopped mentioning the duration (delete this assertion) or it now phrases it " +
        "some other way (re-point the matcher) — but this guard was passing on absence.",
    ).toBe(true);
    if (boostLine) {
      expect(
        Number(boostLine.match(/(\d+) hours/)![1]),
        `Dashboard.tsx's boost toast says "${boostLine.trim().slice(0, 90)}" as a literal, ` +
          `while JobBoostDialog derives the same fact from BOOST_DURATION_HOURS ` +
          `(= ${BOOST_DURATION_HOURS}). Import the constant here too.`,
      ).toBe(BOOST_DURATION_HOURS);
    }
    expect(
      repoFile("src/components/JobBoostDialog.tsx"),
      "JobBoostDialog stopped importing BOOST_DURATION_HOURS",
    ).toContain("BOOST_DURATION_HOURS");
  });
});

// ===========================================================================
// 5 — consequences with no backend at all
// ===========================================================================

describe("consequences the app states must be delivered by something", () => {
  it("FINDING — the dispute-velocity threshold is enforced by nothing", () => {
    // COPY: "3+ disputes in 30 days flags your account for review."
    //   src/components/DisputeDialog.tsx:291
    //   src/pages/legal/CommunitySection.tsx:232  (independently retyped)
    //
    // BACKEND CHECKED: public.check_dispute_velocity(uuid), defined in
    // 20260325045032, returns `count(*) < 3 ... interval '30 days'`. So the
    // NUMBERS are right. But 20260505225000 revoked EXECUTE on it, and its own
    // header records why: "check_dispute_velocity: 0 callsites in repo". Nothing
    // in src/, nothing in supabase/functions/, and no trigger calls it. The
    // function is dead code, so no account is flagged by anything, ever.
    //
    // STATUS: the statement is currently FALSE. Reported, not changed.
    //
    // The assertion is written so it fails the DAY someone wires it up — at
    // which point the copy needs re-checking against the real threshold rather
    // than assumed correct.
    const callers = execFileSync(
      "bash",
      ["-c", "grep -rl 'check_dispute_velocity' src supabase/functions 2>/dev/null || true"],
      { cwd: ROOT, encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean)
      // The generated types file lists every RPC signature; naming one there is
      // not calling it. And this test file itself contains the string.
      .filter((f) => !f.includes("integrations/supabase/types.ts") && !/\.test\./.test(f));

    expect(
      callers,
      "check_dispute_velocity now HAS callers (" + callers.join(", ") + "). Two surfaces " +
        "tell users '3+ disputes in 30 days flags your account' — re-derive both from the " +
        "real threshold now that one exists, and drop this finding.",
    ).toEqual([]);

    // And the copy that makes the promise is still there, unchanged.
    expect(
      repoFile("src/components/DisputeDialog.tsx"),
      "the dispute-velocity sentence moved — re-locate this finding",
    ).toMatch(/3\+ disputes in 30 days/);
  });

  it("no report-review SLA is promised, because nothing delivers one", () => {
    // WAS: a FINDING that pinned the presence of the sentence
    //   'Our team reviews all reports within 24 hours.'
    // in helpCenterContent.ts, so the finding could be re-located later.
    //
    // BACKEND CHECKED (unchanged, re-verified here): the `reports` table has no
    // deadline column, no trigger and no cron; `supabase/functions/` contains
    // `review-nag-cron` for REVIEWS, not reports; nothing escalates an unread
    // report. No number was ever true, so the sentence was deleted rather than
    // corrected — a turnaround with no instrument behind it is a promise we can
    // only break, and picking a different figure would just have moved the lie.
    //
    // The test is INVERTED, not deleted. Pinning the presence of a sentence
    // that has been fixed is a guard that fails on the fix and passes on the
    // regression — precisely backwards. It now holds the removal in place: any
    // report-review turnaround coming back fails here and has to justify itself
    // against a mechanism that still does not exist.
    const fns = execFileSync("bash", ["-c", "ls supabase/functions"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const hasSlaFn = /report.*(sla|escalat|nag|deadline)/i.test(fns);
    expect(
      hasSlaFn,
      "a report-SLA function now exists — a report-review turnaround may finally be " +
        "stated, but DERIVE it from that function's schedule rather than hand-typing it, " +
        "and drop this guard's second half",
    ).toBe(false);

    // Report-review turnaround claims, anywhere in user-facing copy.
    const PROMISE =
      /reports?\b[^.!?\n]{0,60}\bwithin\s+(?:about\s+)?(?:one|two|a\s+few|\d+)\s*(?:business\s+)?(?:hour|day)s?/i;
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      stripComments(repoFile(file))
        .split("\n")
        .forEach((line, i) => {
          const m = line.match(PROMISE);
          if (m) offenders.push(`${file}:${i + 1} — "${m[0].trim().slice(0, 90)}"`);
        });
    }
    expect(
      offenders,
      "a report-review turnaround is being promised again, and there is still no " +
        "deadline column, trigger, cron or edge function that measures or escalates an " +
        "unread report. Nothing can make this number true:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("the GPS proximity radius the legal page states is the radius mark_helper_arrival enforces", () => {
    // COPY: src/pages/legal/CommunitySection.tsx —
    //   "GPS proximity check-in: Within 500 ft of the job location."
    //
    // BACKEND CHECKED: public.mark_helper_arrival, migration 20260828011057 —
    // a server-side haversine in feet, then `v_verified := v_dist <= 500`.
    // So this one IS true. It is pinned rather than trusted because it is the
    // shape of claim that goes stale silently: the number lives twice (a legal
    // document and a plpgsql body) with no shared constant between them, and
    // the sentence is exactly the kind a user quotes back after a disputed
    // "GPS confirmed · 1792 mi from job" caption.
    const sql = repoFile("supabase/migrations/20260828011057_verified_arrival_gate.sql");
    const enforced = sql.match(/v_verified\s*:=\s*v_dist\s*<=\s*(\d+)/)?.[1];
    expect(
      enforced,
      "mark_helper_arrival no longer computes the arrival radius here — the live " +
        "definition moved to a later migration and this guard is blind",
    ).toBeDefined();
    expect(
      repoFile("src/pages/legal/CommunitySection.tsx"),
      `the legal page must state the ${enforced} ft radius mark_helper_arrival actually ` +
        `enforces (20260828011057). There is no shared constant between the two — if the ` +
        `SQL moves, only this test stands between the change and a false statement in a ` +
        `binding document.`,
    ).toMatch(new RegExp(`${enforced}\\s*ft`));
  });
});
