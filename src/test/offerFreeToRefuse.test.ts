/**
 * GUARD (Q1281, owner decision 2026-10-05, pop-up): NO strike for declining OR
 * ignoring an offer. Strikes are only for backing out AFTER accepting.
 *
 * THE BUG (live bodies read 2026-10-12): decline_job_offer and both passes of
 * expire_unanswered_offers (single offer and crew spot) called
 * apply_job_denial_consequence for a Helpr who had never tapped Accept. Fixed
 * by 20261012184444_offer_free_to_refuse.sql. PGlite proof (7 FAIL on main's
 * bodies, ALL PASS with the migration applied 3x):
 * src/test/pglite/offerFreeToRefuse.pglite.mjs.
 *
 * THE CLASS, from the migrations' EFFECTIVE definitions (newest CREATE plus
 * later rewrites, any dollar tag, comments and string literals blanked):
 * every function that files a reliability strike (apply_job_denial_consequence)
 * gates EACH call on an accept stamp (`…confirmed_at IS NULL THEN` refusal, or
 * `…confirmed_at IS NOT NULL` in the IF / boolean the call is gated on), or is
 * on the short reviewed list of strikers whose own state already proves an
 * accept (a started job, a booked series visit). The same predicate run on the
 * migrations BEFORE 20261012184444 finds exactly the two offer handlers, so
 * this test is shown able to fail on the original bug, not only on a fixture.
 *
 * The app: the Decline confirm, the countdown line, the poster's deadline
 * dialog and the community rules say declining or not answering is no strike.
 *
 * @mutate supabase/migrations/20261012184444_offer_free_to_refuse.sql |   v_result := jsonb_build_object('action', 'none', 'reason', 'offer_free_to_decline'); |   v_result := public.apply_job_denial_consequence(v_app_helper, v_job_id, 'Declined job offer');
 * @mutate supabase/migrations/20261012184444_offer_free_to_refuse.sql |       v_setup_unfinished := public.helper_accept_block_reason(v_locked.helper_id) IS NOT NULL | PERFORM public.apply_job_denial_consequence(v_locked.helper_id, v_locked.id, 'expired');\n      v_setup_unfinished := public.helper_accept_block_reason(v_locked.helper_id) IS NOT NULL
 * @mutate supabase/migrations/20261012184444_offer_free_to_refuse.sql |       v_crew_setup_unfinished := public.helper_accept_block_reason(v_slot.helper_id) IS NOT NULL | PERFORM public.apply_job_denial_consequence(v_slot.helper_id, v_cjob.id, 'expired');\n      v_crew_setup_unfinished := public.helper_accept_block_reason(v_slot.helper_id) IS NOT NULL
 * @mutate supabase/migrations/20261012184444_offer_free_to_refuse.sql |                ELSE '" and it went back to everyone. No strike.' |                ELSE '" and it went back to everyone. Letting an offer expire counts the same as declining it.'
 * @mutate supabase/migrations/20261012184444_offer_free_to_refuse.sql |                ELSE '" and you lost your spot. No strike.' |                ELSE '" and you lost your spot.'
 * @mutate supabase/migrations/20261012184444_offer_free_to_refuse.sql | One more — backing out of a job you accepted — and | One more — declining, ignoring, or cancelling a job you committed to — and
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx | Declining isn't a strike." | Backing out now counts against your account."
 * @mutate src/pages/jobs/appliedJobCard/OfferedActions.tsx | "If you don't answer in time, the job reopens to everyone. No strike." | "No answer counts the same as declining, and the job reopens to everyone."
 * @mutate src/components/ResponseDeadlineDialog.tsx | Declining an offer, or not answering it, is never a strike. Helprs who back out after accepting face | Helprs who decline jobs repeatedly will face
 * @mutate src/pages/info/legal/CommunitySection.tsx | <li>Declining an offer, or letting one expire, does not count. Only backing out <em>after</em> you accept does.</li> | <li>Declining multiple offers counts.</li>
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, type FnDef } from "./helpers/effectiveFunctionDefs";

const REPO = join(__dirname, "..", "..");
const MIG = join(REPO, "supabase", "migrations");
const FIX = "20261012184444_offer_free_to_refuse.sql";
const STRIKE = /apply_job_denial_consequence\s*\(/gi;

const blankStrings = (sql: string) => sql.replace(/'(?:[^']|'')*'/g, (m) => "'" + " ".repeat(m.length - 2) + "'");
const code = (d: FnDef) => blankStrings(blankSqlComments(d.stmt));

/**
 * The accept-stamp gate shapes hireMomentIsTheAccept.test.ts accepts. A
 * heuristic: a gate anywhere in the text before a strike call counts, not only
 * the IF that wraps it, so a new striker with an unrelated confirmed_at test
 * earlier in its body would pass. decline_job_offer and
 * expire_unanswered_offers are pinned separately with a hard "no strike call".
 */
const GATE = [
  /confirmed_at\s+IS\s+NULL\s+THEN/i,
  /\bIF\b(?:(?!\bTHEN\b)[^;])*confirmed_at\s+IS\s+NOT\s+NULL/i,
  /:=(?:(?!\bTHEN\b)[^;])*confirmed_at\s+IS\s+NOT\s+NULL/i,
];

/**
 * Strikers whose OWN state is the accept, reviewed by hand (2026-10-12, live
 * bodies): each strikes only a Helpr who is already committed, through a
 * check other than a confirmed_at stamp.
 */
const COMMITTED_BY_STATE: Record<string, string> = {
  apply_job_denial_consequence: "the ladder itself (its own CREATE line is the match, not a call)",
  helper_abort_job: "refuses anything but an in_progress / revision_requested job: the Helpr started it",
  series_give_up_strike:
    "a Helpr giving up, under 24 h out, visits of a series they claimed (20261007051854_series_claim_is_an_accept: a claim is an accept)",
};

function ungated(defs: Map<string, FnDef>): string[] {
  return [...defs.entries()]
    .filter(([name, d]) => !(name in COMMITTED_BY_STATE) && (code(d).match(STRIKE)?.length ?? 0) > 0)
    .filter(([, d]) => {
      const segments = code(d).split(STRIKE);
      return segments.slice(0, -1).some((seg) => !GATE.some((g) => g.test(seg)));
    })
    .map(([name]) => name)
    .sort();
}

const now = effectiveDefs(MIG);
const before = effectiveDefs(MIG, { before: FIX });
const body = (fn: string) => blankSqlComments(now.get(fn)!.stmt);

describe("an offer is free to refuse (Q1281)", () => {
  it("reads the real definitions (floor)", () => {
    expect(now.size).toBeGreaterThan(400);
    const strikers = [...now.entries()].filter(([, d]) => (code(d).match(STRIKE)?.length ?? 0) > 0);
    // apply_job_denial_consequence (its own CREATE line), helper_cancel_booking,
    // block_user_and_settle, helper_abort_job, series_give_up_strike on 2026-10-12.
    // (report_helper_no_show strikes through apply_consequence_ladder.)
    expect(strikers.length).toBeGreaterThanOrEqual(4);
  });

  it("decline_job_offer and expire_unanswered_offers are the newest definitions and file no strike", () => {
    for (const fn of ["decline_job_offer", "expire_unanswered_offers"]) {
      expect(now.get(fn)?.file, `${fn} was restated after ${FIX}: re-read it`).toBe(FIX);
      expect(code(now.get(fn)!), `${fn} strikes a Helpr who never accepted`).not.toMatch(STRIKE);
    }
    expect(body("decline_job_offer")).toContain("v_result := jsonb_build_object('action', 'none', 'reason', 'offer_free_to_decline');");
    // Every Helpr-facing expiry sentence says it, on both passes.
    const expire = body("expire_unanswered_offers");
    const sentences = [...expire.matchAll(/(?:THEN|ELSE)\s+'"[^']*(?:''[^']*)*'/g)].map((m) => m[0]);
    const helperLines = sentences.filter((s) => /went back to everyone|lost your spot/.test(s));
    expect(helperLines.length, "the Helpr's sentences moved; re-read the sweep").toBe(6);
    for (const s of helperLines) expect(s).toMatch(/No strike\./);
    expect(expire).not.toMatch(/counts the same as declining/);
  });

  it("the strike ladder's own words no longer count declining or ignoring (money review of 250d0d72a, #1)", () => {
    const ladder = now.get("apply_job_denial_consequence")!;
    expect(ladder.file).toBe(FIX);
    const literals = [...blankSqlComments(ladder.stmt).matchAll(/'(?:[^']|'')*'/g)].map((m) => m[0]).join(" ");
    expect(literals).toContain("backing out of a job you accepted");
    expect(literals, "a ladder notice still says declining or ignoring is a strike").not.toMatch(/declin|ignor/i);
  });

  it("CLASS: every strike call is gated on an accept stamp (or a reviewed committed state)", () => {
    expect(ungated(now)).toEqual([]);
  });

  it("the class predicate finds the original bug: before the fix, exactly the two offer handlers", () => {
    expect(ungated(before)).toEqual(["decline_job_offer", "expire_unanswered_offers"]);
  });

  it("every reviewed exemption still exists and still strikes (exact, two-way)", () => {
    for (const fn of Object.keys(COMMITTED_BY_STATE)) {
      expect(now.has(fn), `${fn} is gone: drop it from COMMITTED_BY_STATE`).toBe(true);
    }
    const strikersWithoutGate = [...now.entries()]
      .filter(([, d]) => (code(d).match(STRIKE)?.length ?? 0) > 0)
      .filter(([, d]) => code(d).split(STRIKE).slice(0, -1).some((seg) => !GATE.some((g) => g.test(seg))))
      .map(([n]) => n)
      .sort();
    expect(strikersWithoutGate, "COMMITTED_BY_STATE must list exactly the strikers with no accept-stamp gate").toEqual(
      Object.keys(COMMITTED_BY_STATE).sort(),
    );
  });
});

describe("the app says an offer is free to refuse (Q1281)", () => {
  const src = (p: string) => blankComments(readFileSync(join(REPO, p), "utf8"));

  it("the Decline confirm and the countdown line promise no strike, unconditionally", () => {
    const card = src("src/pages/jobs/appliedJobCard/OfferedActions.tsx");
    expect(card).toContain(`description="You applied for this one and the person who posted it picked you. Declining isn't a strike."`);
    expect(card).toContain(`"If you don't answer in time, the job reopens to everyone. No strike."`);
    expect(card).not.toMatch(/RELIABILITY_LADDER_SENTENCE|counts against your account|counts the same as declining/);
  });

  it("the poster's deadline dialog and the community rules say the same", () => {
    expect(src("src/components/ResponseDeadlineDialog.tsx")).toContain(
      "Declining an offer, or not answering it, is never a strike. Helprs who back out after accepting face escalating consequences:",
    );
    const legal = src("src/pages/info/legal/CommunitySection.tsx");
    expect(legal).toContain("<li>Declining an offer, or letting one expire, does not count. Only backing out <em>after</em> you accept does.</li>");
    expect(legal).not.toMatch(/declining multiple offers triggers/i);
  });
});
