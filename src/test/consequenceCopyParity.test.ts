import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  RELIABILITY_LADDER_RUNGS,
  RELIABILITY_LADDER_SENTENCE,
  NO_SHOW_LADDER_SENTENCE,
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

const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

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
      SQL.match(/p_permanent_requires_review\s*=>\s*true/),
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
    expect(
      SQL,
      "GUARD 3b (escalate on DISTINCT reporters) is gone — NO_SHOW_LADDER_SENTENCE's " +
        "'from a different poster' clause is now a lie, and one poster can drive a " +
        "Helpr to the top rung by themselves",
    ).toMatch(/DISTINCT[\s\S]{0,400}report/i);
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

  it("the shared rungs still say what the restated copies say (they agree TODAY)", () => {
    // Pinning the agreement means that when the SQL moves, the SHARED module is
    // updated (parity test forces it) and THIS test then fails, naming every
    // hand-typed copy that was left behind. It turns three silent drifts into
    // three named files.
    const shared = RELIABILITY_LADDER_RUNGS.join(" | ").toLowerCase();
    expect(shared, "rung 2 is no longer a final warning").toContain("final warning");
    expect(shared, "rung 3 is no longer a 7-day suspension").toContain("7-day suspension");

    for (const file of ["src/components/CancellationDialog.tsx", "src/pages/legal/CommunitySection.tsx"]) {
      const src = stripComments(repoFile(file));
      expect(
        src,
        `${file} hand-types a 3rd-strike consequence; the shared ladder says ` +
          `"${RELIABILITY_LADDER_RUNGS[3]}". Both must say a person decides — ` +
          `an automatic permanent ban is a sentence a restricted user quotes back at us.`,
      ).toMatch(/permanent ban is never automatic|admin reviews/i);
    }
    expect(
      RELIABILITY_LADDER_SENTENCE,
      "the one-sentence ladder no longer routes the top rung through an admin",
    ).toMatch(/admin/);
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
   *   "reviews all reports within 24 hours"
   *                                    src/pages/helpCenter/helpCenterContent.ts
   *
   * against REVIEW_SLA = "under 2 hours". Four numbers for "how long until a
   * human looks at this". FINDING, not fixed here.
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
      "src/pages/helpCenter/helpCenterContent.ts":
        "'reviews all reports within 24 hours' — see the 'delivered by nothing' test below",
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
    const a = repoFile("src/components/InstantPayoutDialog.tsx");
    const b = repoFile("src/components/profile/earningsTab/PayoutHistory.tsx");
    const days = (t: string) => [...t.matchAll(/(\d)(?:\s*[–-]\s*(\d))?\s*business days/g)]
      .flatMap((m) => [m[1], m[2]].filter(Boolean));
    expect(
      days(a).concat(days(b)).length,
      "the payout-window sentences vanished from one of the two files — update this test",
    ).toBeGreaterThan(0);
    expect(
      new Set(days(a).concat(days(b)).map(Number).map((n) => n)).size === 1,
      `InstantPayoutDialog says "${days(a).join("–")} business days" and PayoutHistory says ` +
        `"${days(b).join("–")} business days" for the same standard payout. Neither is derived ` +
        `from a constant. Add one (src/lib/ has the pattern) and interpolate it in both.`,
    ).toBe(true);
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

  it("FINDING — the referral cap the copy states is not enforced anywhere", () => {
    // "Up to 5 friends ($25 max)" (ReferralSection.tsx:203, and the +$5 · $25
    // max rung in ReferralExtras.tsx). Checked: check_referral_bonus
    // (20260311032939 → 20260312012642 → 20260823010000) and the
    // referral_credits_one_per_reason unique index. The index dedupes ONE bonus
    // per (user, code, referred user, reason). There is NO cap of five and no
    // $25 ceiling in any migration or edge function. A user who refers ten
    // people is credited $50.
    //
    // The statement is therefore FALSE (in the user's favour, which is why
    // nobody reported it). It is asserted here so that IF a cap is ever added,
    // this test fails and the copy gets checked against it — and so the claim
    // is on the record rather than in a reviewer's head.
    const migrations = execFileSync("git", ["ls-files", "supabase/migrations"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim().split("\n");
    const capped = migrations.filter((m) => {
      const sql = repoFile(m);
      return /referral/i.test(sql) && /count\(\*\)\s*[<>]=?\s*5\b|max_referrals|referral_limit/i.test(sql);
    });
    expect(
      capped,
      "a referral cap now EXISTS in SQL (" + capped.join(", ") + "). ReferralSection.tsx " +
        "has always claimed 'Up to 5 friends ($25 max)' — check the copy against the real " +
        "cap and then delete this test's finding note.",
    ).toEqual([]);
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
    const dash = stripComments(repoFile("src/pages/Dashboard.tsx"));
    const boostLine = dash.split("\n").find((l) => /boost/i.test(l) && /\d+ hours/.test(l));
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

  it("FINDING — 'we review all reports within 24 hours' is delivered by nothing", () => {
    // COPY: src/pages/helpCenter/helpCenterContent.ts:189 —
    //   'Our team reviews all reports within 24 hours.'
    //
    // BACKEND CHECKED: the `reports` table has no deadline column, no trigger,
    // no cron. There is no edge function for report SLA (the full list in
    // supabase/functions/ contains review-nag-cron for REVIEWS, not reports),
    // and no scheduled job escalates an unread report. The claim is a human
    // process promise with nothing measuring it — the same shape as the
    // "handled within 24 hours" the owner found.
    //
    // STATUS: unverifiable from code; nothing in the product enforces or
    // measures it. Reported, not changed. This assertion pins the fact that no
    // mechanism appeared — if one does, the number should be derived from it.
    const fns = execFileSync("bash", ["-c", "ls supabase/functions"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(
      /report.*(sla|escalat|nag|deadline)/i.test(fns),
      "a report-SLA function now exists — derive the Help Center's '24 hours' from its " +
        "schedule instead of leaving it hand-typed",
    ).toBe(false);
    expect(
      repoFile("src/pages/helpCenter/helpCenterContent.ts"),
      "the 24-hour report promise moved — re-locate this finding",
    ).toMatch(/reviews all reports within 24 hours/);
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
