import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  RELIABILITY_LADDER_RUNGS,
  RELIABILITY_LADDER_SENTENCE,
} from "./reliabilityLadder";

/**
 * reliabilityLadder ↔ SQL parity.
 *
 * The money surface already has this discipline (posterFees.parity.test.ts,
 * productPrices.parity.test.ts): the number the UI SAYS is read out of the same
 * place the server USES. This is the same guard for a CONSEQUENCE LADDER, which
 * is where the overnight audit found the drift — user-facing copy promised
 * "three declines gets a warning, five is a ban" while the live RPC had moved
 * to final-warning@2 / 7-day-suspension@3 / permanent@4.
 *
 * These tests read the migration TEXT (the same convention the money parity
 * tests use to read their sibling source of truth) and assert the TS strings
 * every screen renders still describe the CASE branches the RPC executes.
 * Failure messages name the drift concretely — which rung, which side.
 */

// vitest runs with the repo root as cwd (vitest.config.ts lives there), which
// is how the money parity tests reach their sibling edge sources too.
const repoFile = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const read = (name: string) => repoFile(`supabase/migrations/${name}`);

const DENIAL_SQL = read("20260824243000_reliability_ladder_temp_ban_and_cancel_booking.sql");
const MESSAGE_SQL = read("20260825183000_message_violation_ladder_human_review.sql");

/**
 * Pull the `v_action := CASE ... END;` ladder out of a plpgsql function body
 * and return it as strike-number → action, where strike N is the offence
 * recorded when `v_prior_count = N - 1` (the RPC counts PRIOR violations, the
 * copy counts the offence the user just committed — the off-by-one that made
 * "five is a ban" read plausible while the RPC banned on the fourth).
 */
function ladderFromSql(sql: string, functionName: string): Record<number, string> {
  const fnStart = sql.indexOf(`FUNCTION public.${functionName}`);
  expect(
    fnStart,
    `${functionName} is no longer defined in this migration — the ladder moved and this guard is now blind`,
  ).toBeGreaterThan(-1);
  const caseStart = sql.indexOf("v_action := CASE", fnStart);
  const caseEnd = sql.indexOf("END;", caseStart);
  expect(
    caseStart > -1 && caseEnd > caseStart,
    `could not find the "v_action := CASE ... END;" ladder inside ${functionName}`,
  ).toBe(true);
  const block = sql.slice(caseStart, caseEnd);

  const ladder: Record<number, string> = {};
  // `WHEN v_prior_count >= N THEN 'action'` — the open-ended top rung.
  let atLeast: { count: number; action: string } | null = null;
  for (const m of block.matchAll(/WHEN v_prior_count >= (\d+) THEN '([a-z_]+)'/g)) {
    atLeast = { count: Number(m[1]), action: m[2] };
  }
  // `WHEN v_prior_count = N THEN 'action'` — the exact rungs.
  for (const m of block.matchAll(/WHEN v_prior_count = (\d+) THEN '([a-z_]+)'/g)) {
    ladder[Number(m[1]) + 1] = m[2];
  }
  // `ELSE 'action'` — the first offence.
  const elseMatch = block.match(/ELSE '([a-z_]+)'/);
  expect(elseMatch, `${functionName}'s CASE has no ELSE branch — the first offence is unclassified`).not.toBeNull();
  ladder[1] = elseMatch![1];
  if (atLeast) ladder[atLeast.count + 1] = atLeast.action;
  return ladder;
}

/** Days in the `interval 'N days'` used by a named action branch. */
function suspensionDays(sql: string, afterMarker: string): number {
  const from = sql.indexOf(afterMarker);
  expect(from, `marker ${afterMarker} not found — the temp-ban branch was renamed`).toBeGreaterThan(-1);
  const m = sql.slice(from).match(/interval '(\d+) days'/);
  expect(m, "the temp-ban branch no longer sets an `interval 'N days'` suspension").not.toBeNull();
  return Number(m![1]);
}

describe("reliability ladder — TS copy ↔ apply_job_denial_consequence (SQL)", () => {
  const ladder = ladderFromSql(DENIAL_SQL, "apply_job_denial_consequence");
  const days = suspensionDays(DENIAL_SQL, "v_action = 'temp_ban'");

  it("the RPC still runs the four-rung ladder the copy describes", () => {
    // If this fails, the SQL moved: fix reliabilityLadder.ts to match, don't
    // relax the expectation.
    expect(ladder, "apply_job_denial_consequence's CASE branches changed shape").toEqual({
      1: "none",
      2: "warning",
      3: "temp_ban",
      4: "permanent_ban",
    });
  });

  it("the TS module states exactly one rung per SQL rung", () => {
    const sqlRungs = Object.keys(ladder).length;
    expect(
      RELIABILITY_LADDER_RUNGS.length,
      `RELIABILITY_LADDER_RUNGS lists ${RELIABILITY_LADDER_RUNGS.length} rungs but the RPC has ${sqlRungs} — ` +
        `the bullet list and the enforced ladder disagree (this is the 5-strike-copy / 4-strike-RPC drift)`,
    ).toBe(sqlRungs);
  });

  it("each rung's copy names the consequence its SQL branch applies", () => {
    // strike 1 — 'none': recorded only, and the copy must not threaten a penalty.
    expect(
      RELIABILITY_LADDER_RUNGS[0].toLowerCase(),
      `rung 1 copy "${RELIABILITY_LADDER_RUNGS[0]}" must say no penalty — the RPC's action is '${ladder[1]}'`,
    ).toMatch(/no penalty|recorded/);

    // strike 2 — 'warning': the RPC sets profiles.ban_status = 'final_warning'.
    expect(
      DENIAL_SQL,
      "the warning branch no longer sets ban_status = 'final_warning'",
    ).toMatch(/v_action = 'warning'[\s\S]{0,400}ban_status = 'final_warning'/);
    expect(
      RELIABILITY_LADDER_RUNGS[1].toLowerCase(),
      `rung 2 copy "${RELIABILITY_LADDER_RUNGS[1]}" must say "final warning" — the RPC sets ban_status='final_warning' here`,
    ).toContain("final warning");

    // strike 3 — 'temp_ban': N-day suspension, N read out of the SQL interval.
    expect(
      RELIABILITY_LADDER_RUNGS[2].toLowerCase(),
      `rung 3 copy "${RELIABILITY_LADDER_RUNGS[2]}" must state a ${days}-day suspension — ` +
        `the RPC sets auto_suspended_until = now() + interval '${days} days'`,
    ).toContain(`${days}-day suspension`);

    // strike 4 — 'permanent_ban'.
    expect(
      DENIAL_SQL,
      "the permanent_ban branch no longer writes a 'permanent' user_bans row",
    ).toMatch(/v_action = 'permanent_ban'[\s\S]{0,400}'permanent'/);
    expect(
      RELIABILITY_LADDER_RUNGS[3].toLowerCase(),
      `rung 4 copy "${RELIABILITY_LADDER_RUNGS[3]}" must say "permanent ban"`,
    ).toContain("permanent ban");
  });

  it("each rung's copy is numbered with the strike the RPC applies it on", () => {
    const ordinal = ["1st", "2nd", "3rd", "4th"];
    RELIABILITY_LADDER_RUNGS.forEach((rung, i) => {
      expect(
        rung,
        `rung ${i + 1} ("${rung}") must be labelled "${ordinal[i]}" — the RPC applies '${ladder[i + 1]}' ` +
          `on strike ${i + 1} (v_prior_count = ${i}), so an off-by-one here is the ` +
          `"five is a ban / RPC bans on the fourth" bug all over again`,
      ).toContain(ordinal[i]);
    });
  });

  it("the one-sentence version agrees with the same SQL ladder", () => {
    const s = RELIABILITY_LADDER_SENTENCE.toLowerCase();
    expect(s, `"${RELIABILITY_LADDER_SENTENCE}" must call the SECOND strike a final warning`).toMatch(
      /second is a final warning/,
    );
    expect(
      s,
      `"${RELIABILITY_LADDER_SENTENCE}" must say the THIRD strike suspends for ${days} days ` +
        `(SQL: interval '${days} days')`,
    ).toMatch(new RegExp(`third[^.]*${days} days`));
    expect(s, `"${RELIABILITY_LADDER_SENTENCE}" must say the FOURTH strike is permanent`).toMatch(
      /fourth is permanent/,
    );
    // And it must NOT quote a fifth strike — the retired ladder's tell.
    expect(s, "the sentence still mentions a fifth strike — that ladder is retired").not.toMatch(/fifth/);
  });

  it("the RPC's own notification copy quotes the same rungs", () => {
    // The push/notification text the RPC inserts is user-facing copy too, and
    // it is written in the migration rather than in TS — so it drifts the same
    // way. Second strike must be announced as the second, third as the third.
    expect(DENIAL_SQL).toContain("This is your second reliability strike.");
    expect(DENIAL_SQL).toContain("Third reliability strike");
    expect(DENIAL_SQL, `the suspension notification must quote ${days} days`).toMatch(
      new RegExp(`suspended for ${days} days`),
    );
    expect(DENIAL_SQL).toContain("A fourth strike is a permanent ban.");
  });
});

describe("message-violation ladder — client copy ↔ apply_message_violation_consequence (SQL)", () => {
  const ladder = ladderFromSql(MESSAGE_SQL, "apply_message_violation_consequence");
  const days = suspensionDays(MESSAGE_SQL, "v_action = 'pending_ban_review'");

  // NOTE (reported, not fixed): unlike the reliability ladder, this one has NO
  // shared TS module — the rung copy is retyped in three places
  // (messagesData/sendHandlers.ts, and two toasts in messages/logViolation.ts).
  // Until it gets its own `messageViolationLadder.ts`, this test reads those
  // files as text, which is the only thing standing between the copy and the RPC.
  const src = (p: string) => repoFile(`src/${p}`);
  const SEND_HANDLERS = src("pages/messages/messagesData/sendHandlers.ts");
  const LOG_VIOLATION = src("pages/messages/logViolation.ts");

  it("the RPC runs warning → final_warning → pending_ban_review (no auto permanent ban)", () => {
    expect(ladder).toEqual({
      1: "warning",
      2: "final_warning",
      3: "pending_ban_review",
    });
    // The third rung must stay REVERSIBLE — a permanent ban here would mean the
    // client's "an admin is reviewing it" copy is a lie.
    expect(
      MESSAGE_SQL,
      "the pending_ban_review branch must set ban_status='temp_banned', never 'permanently_banned'",
    ).toMatch(/v_action = 'pending_ban_review'[\s\S]{0,600}ban_status = 'temp_banned'/);
  });

  it("the first-offence toast promises the SECOND is a final warning, matching the RPC", () => {
    expect(
      SEND_HANDLERS,
      "sendHandlers' first-warning toast no longer says a second offence is a final warning — " +
        `the RPC applies '${ladder[2]}' on strike 2`,
    ).toContain("a second one is a final warning");
  });

  it("the final-warning toast quotes the same restriction length as the SQL interval", () => {
    expect(
      LOG_VIOLATION,
      `logViolation's final_warning toast must say "restricted for ${days} days" ` +
        `(SQL: now() + interval '${days} days')`,
    ).toContain(`restricted for ${days} days`);
    expect(
      LOG_VIOLATION,
      `logViolation's pending_ban_review toast must say "restricted for ${days} days"`,
    ).toMatch(new RegExp(`account is restricted for ${days} days`));
    // Both toasts key off the RPC's own action strings — a rename in SQL that
    // isn't mirrored here silently shows the user nothing at all.
    expect(LOG_VIOLATION).toContain(`action === "${ladder[2]}"`);
    expect(LOG_VIOLATION).toContain(`action === "${ladder[3]}"`);
  });

  it("no client surface still threatens an automatic permanent ban for a blocked message", () => {
    for (const [name, text] of [
      ["sendHandlers.ts", SEND_HANDLERS],
      ["logViolation.ts", LOG_VIOLATION],
    ] as const) {
      const toastCopy = [...text.matchAll(/"([^"]{40,})"/g)].map((m) => m[1]);
      for (const line of toastCopy) {
        expect(
          /permanently banned|permanent ban/i.test(line) && !/never|only ever|no automatic/i.test(line),
          `${name} tells the user "${line}" — the RPC's third rung is a reversible ` +
            `${days}-day restriction pending admin review, not a permanent ban`,
        ).toBe(false);
      }
    }
  });
});
