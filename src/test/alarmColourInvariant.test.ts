import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { Constants } from "@/integrations/supabase/types";
import { JOB_STATUS_COLORS, FALLBACK_STATUS_COLOR } from "@/lib/statusColors";
import { deriveCurrentStatusIdx, STATUS_IDX } from "@/components/JobTracking";

/**
 * ONE ALARM COLOUR, ONE MEANING.
 *
 * Two owner findings, one rule.
 *
 *   A. "Working" and "Done" both rendered alarm red on the SAME card. Two dots
 *      in one row, the same colour, two different meanings — so the colour
 *      meant nothing.
 *   B. The rail rule the owner then set: ONE green for completed, yellow for
 *      current, grey for not-reached.
 *
 * A per-screen checklist cannot catch either. Both are statements about a SET
 * of elements ("no two of these may…", "these three and only these three"),
 * and a checklist reads one element at a time. So this file asserts over sets.
 *
 * It also holds the structural half: status colour comes from the tokens in
 * `src/lib/statusColors.ts`, never from a hex literal typed at a call site.
 * A hex at a call site cannot participate in a set rule at all — it is invisible
 * to the token map, invisible to dark mode, and invisible to the next audit.
 */

const ROOT = resolve(__dirname, "../..");
const repoFile = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function sourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f))
    .filter((f) => existsSync(resolve(ROOT, f)));
}

// ===========================================================================
// 1 — colour comes from the token map, not from hex at the call site
// ===========================================================================

describe("status colour comes from statusColors.ts", () => {
  it("no status/step colour is a hex literal at a call site", () => {
    /**
     * Hex is allowed in exactly two situations, both of which are NOT a status
     * colour: a fallback for `resolveToken()` (the native map SDKs cannot read
     * a CSS custom property, so the token is resolved at runtime with a hex
     * fallback), and the boot-loader / native chrome colours that have to exist
     * before any stylesheet does.
     */
    const ALLOWED_FILES = new Set([
      "src/components/TrackingMap.tsx",
      "src/components/dashboard/jobDetailDialog/JobLocationPreview.tsx",
      "src/components/postjob/AppleMapPreview.tsx",
      "src/main.tsx",
    ]);
    const STATUS_CONTEXT =
      /status|badge|chip|pill|step|tracker|dispute|complete|progress|cancel|revision|pending/i;
    const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/;

    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (ALLOWED_FILES.has(file)) continue;
      stripComments(repoFile(file))
        .split("\n")
        .forEach((line, i) => {
          if (!HEX.test(line) || !STATUS_CONTEXT.test(line)) return;
          if (/resolveToken|issue #|PR #|task #|Closes #/.test(line)) return;
          offenders.push(
            `${file}:${i + 1} — "${line.trim().slice(0, 100)}" paints a status/step colour ` +
              `from a hex literal. It cannot follow the theme, cannot be checked against ` +
              `JOB_STATUS_COLORS, and is invisible to every colour rule in this file. ` +
              `Use hsl(var(--token)) via src/lib/statusColors.ts.`,
          );
        });
    }
    expect(offenders, "hex-literal status colours:\n  " + offenders.join("\n  ")).toEqual([]);
  });

  it("the token map is complete and every value is a token reference", () => {
    for (const status of Constants.public.Enums.job_status) {
      const c = JOB_STATUS_COLORS[status];
      expect(c, `JOB_STATUS_COLORS has no entry for "${status}"`).toBeDefined();
      for (const [k, v] of Object.entries(c)) {
        expect(
          v,
          `JOB_STATUS_COLORS.${status}.${k} = "${v}" is not an hsl(var(--token)) reference — ` +
            `a literal here is a theme-blind colour hidden inside the map that is supposed ` +
            `to prevent them`,
        ).toMatch(/^hsl\(var\(--[\w-]+\)/);
      }
    }
    expect(FALLBACK_STATUS_COLOR.bg).toMatch(/^hsl\(var\(--/);
  });

  it("no status uses the DANGER token — this brand has no alarm red for a status", () => {
    // statusColors.ts states the voice explicitly: "no red-alarm", and
    // `disputed` is deliberately kept in the sienna family. A future edit that
    // reaches for --destructive on a status chip is a voice change, and it
    // should have to argue with this line to make it.
    const wrong = Object.entries(JOB_STATUS_COLORS).filter(([, c]) =>
      /--destructive|--error|--danger(?!-ink)/.test(`${c.bg} ${c.text}`),
    );
    expect(
      wrong.map(([s]) => s),
      `these statuses now paint in the danger/alarm family: ${wrong.map(([s]) => s).join(", ")}. ` +
        `statusColors.ts's stated voice is warm-earthy with NO alarm red — 'disputed' is ` +
        `"serious but warm", not red. If the voice changed, change the doc comment too.`,
    ).toEqual([]);
  });
});

// ===========================================================================
// 2 — the progress rail: one colour per meaning, at most one alarm
// ===========================================================================

/**
 * The rail's colour rule, transcribed from JobTracking.tsx (the step map at
 * ~1276-1360). It is transcribed rather than imported because the rule lives
 * inline inside a 1500-line component's render and there is no export to reach
 * — and this lane must not restructure a file twelve agents are editing.
 *
 * The transcription is GUARDED: `it("the transcription still matches the source")`
 * below fails if either predicate is edited, so this cannot silently describe a
 * rail that no longer exists.
 */
type Tone = "alarm" | "amber" | "green" | "bark" | "bark-tint" | "grey";

function railTones(opts: {
  steps: readonly string[];
  displayIdx: number;
  jobStatus: string;
}): Tone[] {
  const { steps, displayIdx, jobStatus } = opts;
  const allDone = displayIdx === steps.length - 1;
  return steps.map((key, idx) => {
    const isActive = idx <= displayIdx;
    const isCurrent = idx === displayIdx;
    const isPassed = idx < displayIdx;
    // JobTracking.tsx:1387 — `const disputedStep = jobStatus === "disputed" && idx === displayIdx`
    //
    // 2026-08-31: this was `disputedWorking = … && s.key === "working"`, which
    // pinned red to the Working step *wherever the cursor actually was*. On a
    // disputed job carrying a completion stamp the cursor sits on Done, so
    // Working AND Done both went red — the "both can't be red" the owner
    // reported. Keying the pin to the CURRENT step instead makes "at most one
    // alarm" true by construction rather than by careful arithmetic: the
    // predicate can match exactly one index, always.
    const disputedStep = jobStatus === "disputed" && idx === displayIdx;
    if (disputedStep) return "alarm";
    if (isCurrent) {
      // JobTracking.tsx: `const currentTone = allDone ? --success-ink : --amber-solid`.
      // The old ternary chain painted the current step ALARM under a dispute and
      // BARK otherwise — a second green a shade off --success-ink. Both were
      // defects the owner named ("both can't be red"; "shouldn't be 2 different
      // green"). Red is now carried solely by `disputedStep` above, so amber
      // means exactly "on this step, not finished" and green means exactly
      // "this step completed".
      return allDone ? "green" : "amber";
    }
    if (isPassed || (isActive && allDone)) return "green";
    if (isActive) return "bark-tint";
    return "grey";
  });
}

describe("the progress rail's colour rule", () => {
  const SOURCE = repoFile("src/components/JobTracking.tsx");

  it("the transcription still matches the source (guards this block going stale)", () => {
    expect(
      SOURCE,
      "the `disputedStep` pin is gone from JobTracking.tsx — railTones() in this " +
        "test no longer describes the rail. Re-read the step map and re-transcribe. " +
        "(If it reverted to a key-based pin like `s.key === \"working\"`, that is the " +
        "regression this file exists to catch: it can match a step that is not the " +
        "cursor, which is how two dots went red at once.)",
    ).toMatch(/disputedStep\s*=\s*jobStatus === "disputed" && idx === displayIdx/);
    expect(
      SOURCE,
      "`currentTone` changed shape — re-transcribe railTones(). It should be the " +
        "two-branch allDone ? --success-ink : --amber-solid, NOT a ternary chain " +
        "keyed on jobStatus (that chain is what put two reds on one card).",
    ).toMatch(/currentTone\s*=\s*allDone[\s\S]{0,200}--amber-solid/);
    expect(
      SOURCE,
      "the current step paints from --destructive again — red must be carried " +
        "ONLY by disputedStep, or two steps can go alarm red at once",
    ).not.toMatch(/currentTone\s*=[\s\S]{0,300}--destructive/);
    expect(
      SOURCE,
      "disputedStep no longer paints --destructive — the alarm colour moved",
    ).toMatch(/hsl\(var\(--destructive\)\)/);
  });

  it("AT MOST ONE step may carry the alarm colour", () => {
    // THE OWNER'S FINDING, REPRODUCED. `deriveCurrentStatusIdx` is exported, so
    // this is a real derivation, not a hypothetical.
    //
    // 2026-08-31: this scenario used to land on `done`, and that WAS the bug —
    // a job under dispute was drawing a completed rail, so the disputed pin
    // (then keyed to the Working step) lit a second red dot behind the cursor.
    // `disputed` now clamps to Working, the same way `revision_requested`
    // already did: work whose outcome is contested is not finished. So the
    // scenario is kept — a helper HAS stamped completion here — but the
    // expected cursor moved with the clamp. Both halves of that fix have to
    // hold for the rail to read correctly, which is why this asserts the
    // derivation before asserting the colours.
    const steps = ["assigned", "confirmed", "job_confirmed", "on_the_way", "arrived", "working", "done"] as const;

    const idx = deriveCurrentStatusIdx({
      trackingStatus: "done",
      jobStatus: "disputed",
      helperCompletedAt: "2026-08-30T12:00:00Z",
    });
    expect(
      idx,
      "a disputed job with a completion stamp no longer clamps to Working — " +
        "re-derive this scenario before trusting the assertion below",
    ).toBe(STATUS_IDX.working);

    const tones = railTones({ steps, displayIdx: idx, jobStatus: "disputed" });
    const alarms = steps.filter((_, i) => tones[i] === "alarm");
    expect(
      alarms,
      `JobTracking.tsx paints ${alarms.length} steps alarm-red at once on a disputed job ` +
        `sitting on "${steps[idx]}": ${alarms.join(" + ")}. ` +
        `Two dots, one colour, two meanings — the colour stops meaning anything, which is ` +
        `exactly the "Working and Done both red on one card" the owner reported. ` +
        `The alarm pin must be able to match at most ONE index. It is now keyed to ` +
        `the cursor (\`idx === displayIdx\`), which guarantees that; a pin keyed to a ` +
        `step NAME does not, because the cursor can be somewhere else entirely. ` +
        `(src/components/JobTracking.tsx, the step map at ~1288 and ~1298.)`,
    ).toHaveLength(1);
  });

  it("a healthy rail is green behind, one accent at the cursor, grey ahead", () => {
    // The owner's stated rule, as a set assertion over the whole row.
    const steps = ["assigned", "confirmed", "job_confirmed", "on_the_way", "arrived", "working", "done"] as const;
    const tones = railTones({ steps, displayIdx: 3, jobStatus: "in_progress" });
    expect(tones.slice(0, 3).every((t) => t === "green"), `steps behind the cursor: ${tones.slice(0, 3)}`).toBe(true);
    // Amber, not bark. The owner's rule: "Yellow if they're on that step until
    // they're done that step." Bark was a second green a shade off the
    // completed --success-ink, so the current step — the one thing the rail
    // exists to point at — was indistinguishable from the ones behind it.
    expect(tones[3], "the current step must be the single accent").toBe("amber");
    expect(
      tones.slice(4).every((t) => t === "grey"),
      `steps ahead of the cursor must all be the not-reached grey, got: ${tones.slice(4)}`,
    ).toBe(true);
  });

  it("a finished rail is ALL green — no accent left over", () => {
    // Owner: "if it reaches Done, all green."
    const steps = ["assigned", "confirmed", "job_confirmed", "on_the_way", "arrived", "working", "done"] as const;
    const tones = railTones({ steps, displayIdx: steps.length - 1, jobStatus: "completed" });
    const odd = steps.filter((_, i) => tones[i] !== "green");
    expect(
      odd,
      `a completed rail must be one colour end to end; these steps are not: ` +
        odd.map((s) => `${s}=${tones[steps.indexOf(s)]}`).join(", "),
    ).toEqual([]);
  });

  it("exactly ONE meaning per colour across the rail's whole state space", () => {
    // The rule stated positively: sweep every (status × cursor position) the
    // rail can be in and assert no colour is ever used for two different roles
    // at once within a single row.
    const steps = ["assigned", "confirmed", "job_confirmed", "on_the_way", "arrived", "working", "done"] as const;
    const collisions: string[] = [];
    for (const jobStatus of Constants.public.Enums.job_status) {
      for (let idx = 0; idx < steps.length; idx++) {
        const tones = railTones({ steps, displayIdx: idx, jobStatus });
        // ONE COLOUR, ONE MEANING — and alarm and amber are now two different
        // meanings, so a row may legitimately carry one of each.
        //   amber = "you are on this step, it is not finished"
        //   alarm = "this is the step that went wrong"
        // What must never happen is TWO of the same: two ambers leaves the
        // reader unable to say where they are, and two alarms was the owner's
        // original finding ("Both can't be red") — Working pinned red under a
        // dispute while the current step went red as well.
        const alarms = tones.filter((t) => t === "alarm").length;
        const ambers = tones.filter((t) => t === "amber").length;
        const dupe = alarms > 1 ? "alarm" : ambers > 1 ? "amber" : null;
        if (dupe) {
          collisions.push(
            `status="${jobStatus}", cursor on "${steps[idx]}" → ${dupe === "alarm" ? alarms : ambers} ` +
              `"${dupe}" steps (${steps.filter((_, i) => tones[i] === dupe).join(", ")})`,
          );
        }
      }
    }
    expect(
      collisions,
      "rail states where more than one step shouts at once — the user cannot tell which " +
        "one is the problem:\n  " + collisions.join("\n  "),
    ).toEqual([]);
  });
});
