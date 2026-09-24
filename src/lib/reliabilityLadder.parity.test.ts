import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  RELIABILITY_LADDER_RUNGS,
  RELIABILITY_LADDER_SENTENCE,
  CANCELLATION_LADDER_RUNGS,
} from "./reliabilityLadder";

/**
 * Consequence-ladder ↔ copy parity.
 *
 * The money surface already has this discipline (posterFees.parity.test.ts,
 * productPrices.parity.test.ts): the number the UI SAYS is read out of the same
 * place the server USES. This is the same guard for the CONSEQUENCE LADDERS,
 * which is where the overnight audit found the drift — user-facing copy
 * promised "three declines gets a warning, five is a ban" while the live RPC
 * had moved to final-warning@2 / 7-day-suspension@3 / permanent@4.
 *
 * THREE ladders now share one core (`apply_consequence_ladder`,
 * 20260829030000) and differ only in the arguments their thin wrappers pass:
 *
 *   apply_job_denial_consequence            — reliability strikes
 *   apply_message_violation_consequence     — off-platform contact
 *   apply_cancellation_violation_consequence — cancelling on a committed Helpr
 *
 * That means the rung tables are now literal `ARRAY[...]` arguments in the
 * migration, which these tests read directly. Pinning all three in ONE file is
 * the point: the failure mode being guarded is editing one ladder and letting
 * the other two — or the copy that describes them — quietly diverge.
 *
 * If a test here fails, the SQL moved: fix the TS/TSX copy to match, don't
 * relax the expectation.
 */

// vitest runs with the repo root as cwd (vitest.config.ts lives there), which
// is how the money parity tests reach their sibling edge sources too.
const repoFile = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

/*
 * `LADDER_SQL` lived here — one migration, read by name, with a comment asking
 * whoever redefined a ladder to remember to repoint it. That instruction had
 * already been missed: 20260915020258 redefined
 * `apply_message_violation_consequence` inside that very file, and nothing
 * noticed. It is dead now that every block resolves through `newestBlock`, and
 * it is DELETED rather than left unused, because an unused pin still reads as
 * "this file grades that migration" to the next person and to
 * `src/test/guardsReadTheNewestMigration.test.ts`.
 */
/**
 * DELETED 2026-09-21 — `wrapperBlock` read one migration BY NAME
 * (20260829030000) and returned that file's definition of a function.
 *
 * That is one `CREATE OR REPLACE` away from blindness: a later migration
 * redefines the ladder, this file keeps asserting against the superseded body,
 * and it stays GREEN while the copy and the live rule disagree. The
 * `message_violation_ladder` half already used `newestBlock` for exactly this
 * reason; the reliability and cancellation halves did not, which is a guard
 * half-fixed and therefore trusted more than it deserved.
 *
 * Verified before the change: no migration later than 20260829030000
 * redefines `apply_job_denial_consequence`,
 * `apply_cancellation_violation_consequence` or `apply_consequence_ladder`, so
 * this conversion asserts against the SAME text it did before — it removes a
 * future failure mode rather than changing today's verdict.
 */


/** `p_name => ARRAY['a', 'b']` → ["a", "b"]. */
function arrayArg(block: string, arg: string): string[] {
  const m = block.match(new RegExp(`${arg}\\s*=>\\s*ARRAY\\[([^\\]]*)\\]`));
  expect(m, `${arg} is no longer passed as an ARRAY[...] literal`).not.toBeNull();
  return m![1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
}

/** `p_name => value` → "value" (booleans, numbers, null). */
function scalarArg(block: string, arg: string): string {
  const m = block.match(new RegExp(`${arg}\\s*=>\\s*([^,\\n]+)`));
  expect(m, `${arg} is no longer passed`).not.toBeNull();
  return m![1].trim();
}

/**
 * Rung table as strike-number → action, where strike N is the offence recorded
 * when there are N-1 priors (the RPC counts PRIOR violations, the copy counts
 * the offence the user just committed — the off-by-one that made "five is a
 * ban" read plausible while the RPC banned on the fourth).
 */
function ladderOf(block: string): Record<number, string> {
  const rungs = arrayArg(block, "p_rungs");
  return Object.fromEntries(rungs.map((r, i) => [i + 1, r]));
}

/**
 * The NEWEST migration's `CREATE OR REPLACE FUNCTION public.<name>(` block,
 * found by scanning every migration, so a later redefinition cannot leave this
 * file asserting against a superseded body.
 */
function newestBlock(name: string): { file: string; block: string } {
  const dir = resolve(process.cwd(), "supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  // Any case, CREATE FUNCTION or CREATE OR REPLACE FUNCTION, `public.` optional.
  const head = new RegExp(`^\\s*create\\s+(or\\s+replace\\s+)?function\\s+(public\\.)?"?${name}"?\\s*\\(`, "im");
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = readFileSync(resolve(dir, files[i]), "utf8");
    const start = sql.search(head);
    if (start === -1) continue;
    const tag = sql.slice(start).match(/\bAS\s+(\$[a-z_]*\$)/i);
    expect(tag, `${name} in ${files[i]} has no dollar-quoted body`).not.toBeNull();
    const open = sql.indexOf(tag![1], start);
    const end = sql.indexOf(tag![1], open + tag![1].length);
    expect(end, `${name}'s body in ${files[i]} is unterminated`).toBeGreaterThan(open);
    return { file: files[i], block: sql.slice(start, end) };
  }
  throw new Error(`no migration defines public.${name} — this guard is blind`);
}

const DENIAL = newestBlock("apply_job_denial_consequence").block;
// Since 20260915020258 the off-platform ladder lives in
// message_violation_ladder(p_description, p_content, p_message_saved); the
// client RPC and the scan trigger are one-line delegates to it.
const MESSAGE_LADDER = newestBlock("message_violation_ladder");
const MESSAGE = MESSAGE_LADDER.block;
const CANCEL = newestBlock("apply_cancellation_violation_consequence").block;

// ---------------------------------------------------------------------------

describe("the shared core still implements the machinery the wrappers assume", () => {
  const core = newestBlock("apply_consequence_ladder").block;

  it("records every offence and returns the {action, prior_count} shape callers read", () => {
    expect(core, "the core no longer writes the user_violations row").toContain(
      "INSERT INTO public.user_violations",
    );
    expect(
      core,
      "the core's return shape changed — every caller reads .action and .prior_count",
    ).toContain("jsonb_build_object('action', v_action, 'prior_count', p_prior_count)");
  });

  it("still opens the trusted-ladder hatch before touching profiles", () => {
    // Without this, prevent_self_escalation() rejects the ban writes and the
    // whole ladder becomes decorative.
    expect(core).toContain("set_config('app.trusted_ladder_write', 'on', true)");
  });

  it("only a ladder that does NOT require review can auto-write a permanent ban", () => {
    expect(
      core,
      "the permanent→review downgrade is gone — a reviewable ladder could now permanently ban",
    ).toMatch(
      /v_effect = 'permanent' AND p_permanent_requires_review[\s\S]{0,160}v_effect := 'review'/,
    );
    expect(
      core,
      "the 'permanent' effect no longer writes a 'permanent' user_bans row",
    ).toMatch(/v_effect = 'permanent'[\s\S]{0,400}'permanent'/);
  });
});

// ---------------------------------------------------------------------------

describe("reliability ladder — TS copy ↔ apply_job_denial_consequence (SQL)", () => {
  const ladder = ladderOf(DENIAL);
  const days = Number(scalarArg(DENIAL, "p_suspension_days"));

  it("the RPC still runs the four-rung ladder the copy describes", () => {
    expect(ladder, "apply_job_denial_consequence's rung table changed shape").toEqual({
      1: "none",
      2: "warning",
      3: "temp_ban",
      4: "pending_ban_review",
    });
    expect(
      arrayArg(DENIAL, "p_effects"),
      "the effects behind those action names changed — the SAME action string now does something else",
    ).toEqual(["record", "final_warning", "suspend", "permanent"]);
  });

  it("the 4th strike goes to a HUMAN — this ladder no longer auto-bans", () => {
    // This was the one ladder that auto-wrote a permanent user_bans row with
    // nobody in the loop. The owner resolved it (2026-08-25): one policy
    // everywhere. Flipping this back is a POLICY change, not a refactor.
    expect(
      scalarArg(DENIAL, "p_permanent_requires_review"),
      "the reliability ladder would now permanently ban with no admin review",
    ).toBe("true");
    expect(
      DENIAL,
      "the 4th strike no longer notifies admins — the case would sit in the queue unseen",
    ).toMatch(/p_admin_message_format\s*=>\s*'%s has %s reliability strikes/);
    // PRESERVED: rungs 2-3 still overwrite the standing status unconditionally,
    // unlike the other two ladders. Only rung 4 moved.
    expect(
      scalarArg(DENIAL, "p_clamp_to_worse_status"),
      "the reliability ladder started clamping to the worse standing status — behaviour change",
    ).toBe("false");
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
    // strike 1 — 'none'/'record': recorded only, and the copy must not threaten
    // a penalty. The SQL says so by passing NO notification copy for rung 1.
    expect(
      DENIAL.match(/jsonb_build_array\((?:\s|--[^\n]*\n)*null::jsonb/),
      "rung 1 now sends the user a notification — it used to be silently recorded",
    ).not.toBeNull();
    expect(
      RELIABILITY_LADDER_RUNGS[0].toLowerCase(),
      `rung 1 copy "${RELIABILITY_LADDER_RUNGS[0]}" must say no penalty — the RPC's action is '${ladder[1]}'`,
    ).toMatch(/no penalty|recorded/);

    // strike 2 — 'warning'/'final_warning': sets profiles.ban_status.
    expect(
      RELIABILITY_LADDER_RUNGS[1].toLowerCase(),
      `rung 2 copy "${RELIABILITY_LADDER_RUNGS[1]}" must say "final warning" — the RPC sets ban_status='final_warning' here`,
    ).toContain("final warning");

    // strike 3 — 'temp_ban'/'suspend': N-day suspension, N read out of the SQL.
    expect(
      RELIABILITY_LADDER_RUNGS[2].toLowerCase(),
      `rung 3 copy "${RELIABILITY_LADDER_RUNGS[2]}" must state a ${days}-day suspension — ` +
        `the RPC passes p_suspension_days => ${days}`,
    ).toContain(`${days}-day suspension`);

    // strike 4 — 'permanent_ban'.
    expect(
      DENIAL,
      "the permanent rung no longer states a ban reason for the user_bans row",
    ).toMatch(/p_ban_reason\s*=>\s*'[^']*reliability strike/);
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
        `(SQL: p_suspension_days => ${days})`,
    ).toMatch(new RegExp(`third[^.]*${days} days`));
    expect(
      s,
      `"${RELIABILITY_LADDER_SENTENCE}" must say the FOURTH strike is a restriction an ADMIN reviews — ` +
        `the RPC applies '${ladder[4]}', not an automatic ban`,
    ).toMatch(/fourth[^.]*admin/);
    expect(
      s,
      `"${RELIABILITY_LADDER_SENTENCE}" must not promise an automatic permanent ban on the fourth strike`,
    ).not.toMatch(/fourth is permanent/);
    // And it must NOT quote a fifth strike — the retired ladder's tell.
    expect(s, "the sentence still mentions a fifth strike — that ladder is retired").not.toMatch(/fifth/);
  });

  it("the RPC's own notification copy quotes the same rungs", () => {
    // The notification text the RPC inserts is user-facing copy too, and it is
    // written in the migration rather than in TS — so it drifts the same way.
    expect(DENIAL).toContain("This is your second reliability strike.");
    expect(DENIAL).toContain("Third reliability strike");
    expect(DENIAL, `the suspension notification must quote ${days} days`).toMatch(
      new RegExp(`suspended for ${days} days`),
    );
    // The rung-3 notice used to end "A fourth strike is a permanent ban." —
    // now false, and exactly the kind of sentence a restricted user quotes back.
    expect(
      DENIAL,
      "the third-strike notification still promises an automatic permanent ban on the fourth",
    ).not.toContain("A fourth strike is a permanent ban.");
    expect(DENIAL).toContain("Fourth reliability strike");
  });
});

// ---------------------------------------------------------------------------

describe("message-violation ladder — client copy ↔ apply_message_violation_consequence (SQL)", () => {
  const ladder = ladderOf(MESSAGE);
  const days = Number(scalarArg(MESSAGE, "p_suspension_days"));

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
    expect(arrayArg(MESSAGE, "p_effects")).toEqual(["notify", "final_warning", "permanent"]);
    // The third rung must stay REVERSIBLE — a permanent ban here would mean the
    // client's "an admin is reviewing it" copy is a lie.
    expect(
      scalarArg(MESSAGE, "p_permanent_requires_review"),
      "the message ladder's top rung would now permanently ban with no admin review",
    ).toBe("true");
    expect(
      MESSAGE,
      "the top rung no longer notifies admins — cases would pile up unseen",
    ).toMatch(/p_admin_message_format\s*=>\s*'%s has %s flagged messages/);
  });

  it("the first-offence toast promises the SECOND is a final warning, matching the RPC — and only fires on the RPC's own verdict", () => {
    // docs/OPEN.md queue #1 residual, 2026-09-15: this toast moved OUT of
    // sendHandlers' synchronous client-side guess — which fired the instant
    // the CLIENT scanner matched, even for phrases ("my number", "my email")
    // the server never acts on — and into logViolation's read of the RPC's
    // own verdict, gated on `action === "warning"`. It now only shows once
    // the server has actually recorded a first strike.
    expect(
      LOG_VIOLATION,
      "logViolation's first-warning toast no longer says a second offence is a final warning — " +
        `the RPC applies '${ladder[2]}' on strike 2`,
    ).toContain("a second one is a final warning");
    expect(
      LOG_VIOLATION,
      `logViolation's first-warning toast must be gated on the RPC's own '${ladder[1]}' verdict`,
    ).toContain(`action === "${ladder[1]}"`);
    // The immediate, synchronous notice (shown before the RPC can possibly
    // have answered) must stay neutral — never claim a strike on a guess.
    expect(
      SEND_HANDLERS,
      "sendHandlers' immediate notice claims a strike before the RPC has answered",
    ).not.toMatch(/this is your first warning/i);
  });

  it("the final-warning toast quotes the same restriction length as the SQL", () => {
    expect(
      LOG_VIOLATION,
      `logViolation's final_warning toast must say "restricted for ${days} days" ` +
        `(SQL: p_suspension_days => ${days})`,
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

// ---------------------------------------------------------------------------

describe("message-violation ladder — the notification says what actually happened (blocked vs hidden)", () => {
  // docs/OPEN.md queue #1 (2026-09-14): a message the server SAVED (201) and
  // hid from the recipient produced "That message was blocked…". Two paths
  // reach this ladder; only the client one blocks.
  const branch = (which: "saved" | "blocked") => {
    const m = MESSAGE.match(/IF p_message_saved THEN([\s\S]*?)\n\s*ELSE\n([\s\S]*?)\n\s*END IF;/);
    expect(m, `${MESSAGE_LADDER.file}: message_violation_ladder no longer branches its copy on p_message_saved`).not.toBeNull();
    return which === "saved" ? m![1] : m![2];
  };
  const quoted = (sql: string) => [...sql.matchAll(/'message', '([^']+)'/g)].map((x) => x[1]);

  it("each branch carries one message per rung", () => {
    expect(quoted(branch("saved"))).toHaveLength(Object.keys(ladderOf(MESSAGE)).length);
    expect(quoted(branch("blocked"))).toHaveLength(3);
  });

  it("the saved-and-hidden copy never says blocked, and says the other person cannot see it", () => {
    for (const line of quoted(branch("saved"))) {
      expect(line, `saved-message copy says "blocked": ${line}`).not.toMatch(/block/i);
      expect(line).toMatch(/hidden from the other person/);
    }
  });

  it("the refused-send copy still says blocked (the message was never saved)", () => {
    for (const line of quoted(branch("blocked"))) expect(line).toMatch(/blocked/i);
  });

  it("the client RPC is the blocked path and the scan trigger is the saved path", () => {
    const rpc = newestBlock("apply_message_violation_consequence");
    const trigger = newestBlock("apply_message_scan_consequence");
    expect(rpc.block, `${rpc.file}: apply_message_violation_consequence must delegate with p_message_saved = false`)
      .toMatch(/public\.message_violation_ladder\(p_description, p_content, false\)/);
    expect(trigger.block, `${trigger.file}: apply_message_scan_consequence must delegate with p_message_saved = true`)
      .toMatch(/public\.message_violation_ladder\(v_reason, NEW\.content, true\)/);
    // The trigger fires only for rows the BEFORE scan kept and hid.
    expect(trigger.block).not.toMatch(/apply_message_violation_consequence\(/);
  });
});

// ---------------------------------------------------------------------------

describe("cancellation ladder — apply_cancellation_violation_consequence (SQL)", () => {
  const ladder = ladderOf(CANCEL);
  const days = Number(scalarArg(CANCEL, "p_suspension_days"));

  it("runs the same reviewable three-rung ladder as the message ladder", () => {
    expect(ladder).toEqual({
      1: "warning",
      2: "final_warning",
      3: "pending_ban_review",
    });
    expect(arrayArg(CANCEL, "p_effects")).toEqual(["notify", "final_warning", "permanent"]);
    expect(
      scalarArg(CANCEL, "p_permanent_requires_review"),
      "cancelling a job would now permanently ban a poster with no admin review",
    ).toBe("true");
  });

  it("ALL THREE ladders now route a permanent ban through a human", () => {
    // The owner's 2026-08-25 decision. If any wrapper flips to false, a
    // surface somewhere is promising a review that will not happen.
    for (const [name, block] of [
      ["apply_job_denial_consequence", DENIAL],
      ["apply_message_violation_consequence", MESSAGE],
      ["apply_cancellation_violation_consequence", CANCEL],
    ] as const) {
      expect(
        scalarArg(block, "p_permanent_requires_review"),
        `${name} would auto-ban without admin review — that is a POLICY change`,
      ).toBe("true");
      // …and the queue AdminBanReview reads filters on this exact string.
      expect(
        arrayArg(block, "p_rungs").slice(-1)[0],
        `${name}'s top rung no longer files a 'pending_ban_review' row, so it will ` +
          `never appear in the admin Ban Review queue`,
      ).toBe("pending_ban_review");
    }
    expect(
      repoFile("src/components/admin/AdminBanReview.tsx"),
      "the Ban Review queue no longer selects on action_taken='pending_ban_review'",
    ).toContain('.eq("action_taken", "pending_ban_review")');
  });

  it("the two reviewable ladders stay in lockstep — one cannot be edited alone", () => {
    // This is the whole reason the three ladders were consolidated. If a future
    // change makes cancellation harsher (or softer) than off-platform contact,
    // that should be a deliberate decision, visible here.
    expect(
      ladderOf(CANCEL),
      "the cancellation and message ladders' rungs diverged — intentional? then update this test",
    ).toEqual(ladderOf(MESSAGE));
    expect(Number(scalarArg(MESSAGE, "p_suspension_days"))).toBe(days);
  });

  it("the LEGAL page states the reviewable ladder, not an automatic permanent ban", () => {
    // Binding copy in a legal document is the worst place for a restated
    // consequence. This list promised "Permanent ban. Final, no appeal." on the
    // 3rd strike while the ladder has only ever applied a reversible 7-day
    // restriction pending review — a sentence a restricted poster would quote
    // back at us.
    const legal = repoFile("src/pages/info/legal/CommunitySection.tsx");
    const section = legal.slice(
      legal.indexOf("Cancellation strikes (posters)"),
      legal.indexOf("Job-denial strikes (Helprs)"),
    );
    expect(section, "the cancellation-strike section vanished — this guard is blind").not.toBe("");
    expect(
      /Permanent ban\. Final, no appeal|One more = permanent ban/.test(section),
      "the legal page promises an automatic permanent ban the cancellation ladder never applies",
    ).toBe(false);
    // The sentence itself now lives in CANCELLATION_LADDER_RUNGS, which is the
    // point — three surfaces used to hand-type this ladder and all three were
    // TRUE, which is exactly why it needed a constant rather than a correction.
    // So the guard follows the constant instead of grepping the page for a
    // literal it no longer contains.
    expect(
      section,
      "the cancellation list stopped reading CANCELLATION_LADDER_RUNGS — it is " +
        "stating the ladder from memory again, in a legal document",
    ).toContain("CANCELLATION_LADDER_RUNGS.map");
    expect(
      CANCELLATION_LADDER_RUNGS.join(" "),
      `the shared cancellation rungs must state the ${days}-day reviewable ` +
        `restriction the ladder actually applies, and that a person decides`,
    ).toMatch(new RegExp(`${days}-day restriction|restricted for ${days} days`, "i"));
    expect(
      CANCELLATION_LADDER_RUNGS.join(" "),
      "the cancellation rungs stopped saying an admin decides — 'restricted for " +
        "7 days' with no human named reads as a countdown to an automatic ban",
    ).toMatch(/admin reviews|admin decides|never automatic/i);
    // And the job-denial list must READ the shared module rather than restate it.
    expect(
      legal,
      "the job-denial ladder is restated on the legal page again instead of reading RELIABILITY_LADDER_RUNGS",
    ).toContain("RELIABILITY_LADDER_RUNGS.map");
  });

  it("its own rung copy quotes the same strike numbers and restriction length", () => {
    expect(CANCEL).toContain("Cancellation warning (1 of 2)");
    expect(CANCEL).toContain("That is your second cancellation after a Helpr committed.");
    expect(CANCEL, `the restriction notice must quote ${days} days`).toMatch(
      new RegExp(`restricted for ${days} days`),
    );
    expect(
      CANCEL,
      "the top rung no longer notifies admins — the 'an admin is reviewing it' copy would be a lie",
    ).toMatch(/p_admin_message_format\s*=>\s*'%s has cancelled %s jobs/);
  });
});
// The rung copy IS the product here — this module exists so no surface can
// state a consequence the RPC does not apply. The suspension length is read
// out of the SQL (`p_suspension_days`), so a copy that quotes a different one
// must fail.
/*
 * THE HELPER'S OWN PROPERTY, asserted rather than assumed.
 *
 * Until 2026-09-21 two thirds of this file read ONE migration by name
 * (20260829030000) via a `wrapperBlock` helper. That is one `CREATE OR
 * REPLACE` away from blindness: a later migration redefines the ladder, this
 * file keeps grading the superseded body, and it stays green while the copy
 * and the live rule disagree.
 *
 * `newestBlock` scans migrations newest-first, so it cannot. But "scans
 * newest-first" is an implementation detail that a refactor could quietly
 * reverse, and `apply_job_denial_consequence` is defined in FOUR migrations —
 * so the difference is observable and worth pinning.
 *
 * Honest limitation: reversing the scan direction makes this file die at
 * COLLECTION, not at this assertion — `newestBlock` is called at module level
 * for DENIAL/CANCEL/the core, and an older migration's body fails the
 * dollar-quote parse first. The file is red either way, but the message you get
 * is an import error rather than this case's name. Keeping the case anyway: it
 * states the property in one readable place, and it is what fails if the
 * module-level calls ever move inside tests.
 */
describe("newestBlock reads the LAST definition, not the first", () => {
  it("picks the newest migration for a function defined in several", () => {
    const dir = resolve(process.cwd(), "supabase/migrations");
    const head = /^\s*create\s+(or\s+replace\s+)?function\s+(public\.)?"?apply_job_denial_consequence"?\s*\(/im;
    const defining = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => head.test(readFileSync(resolve(dir, f), "utf8")))
      .sort();
    // The floor: if this collapses to one file the assertion below is vacuous.
    expect(
      defining.length,
      "apply_job_denial_consequence must be defined in more than one migration " +
        "for this to prove anything — if it is not, pick another multiply-defined function",
    ).toBeGreaterThan(1);
    expect(newestBlock("apply_job_denial_consequence").file).toBe(defining[defining.length - 1]);
  });
});

// @mutate src/lib/reliabilityLadder.ts | 3rd — 7-day suspension | 3rd — 3-day suspension
