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
    // JobTracking.tsx: `const disputedWorking = jobStatus === "disputed" && s.key === "working"`
    const disputedWorking = jobStatus === "disputed" && key === "working";
    if (disputedWorking) return "alarm";
    if (isCurrent) {
      // JobTracking.tsx: the `currentTone` ternary chain.
      if (jobStatus === "disputed") return "alarm";
      if (jobStatus === "revision_requested") return "amber";
      return allDone ? "green" : "bark";
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
      "the `disputedWorking` pin is gone from JobTracking.tsx — railTones() in this " +
        "test no longer describes the rail. Re-read the step map and re-transcribe.",
    ).toMatch(/disputedWorking\s*=\s*jobStatus === "disputed" && s\.key === "working"/);
    expect(
      SOURCE,
      "the `currentTone` ternary changed shape — re-transcribe railTones()",
    ).toMatch(/currentTone\s*=[\s\S]{0,120}jobStatus === "disputed"[\s\S]{0,200}jobStatus === "revision_requested"/);
    expect(
      SOURCE,
      "the current step no longer paints from --destructive under a dispute — " +
        "if the alarm colour moved, re-transcribe",
    ).toMatch(/hsl\(var\(--destructive\)\)/);
  });

  it("AT MOST ONE step may carry the alarm colour", () => {
    // THE OWNER'S FINDING, REPRODUCED. `deriveCurrentStatusIdx` is exported, so
    // this is a real derivation, not a hypothetical: a disputed job whose helper
    // has stamped completion sits on `done`.
    const steps = ["assigned", "confirmed", "job_confirmed", "on_the_way", "arrived", "working", "done"] as const;

    const idx = deriveCurrentStatusIdx({
      trackingStatus: "done",
      jobStatus: "disputed",
      helperCompletedAt: "2026-08-30T12:00:00Z",
    });
    expect(
      idx,
      "a disputed job with a completion stamp no longer lands on the Done step — " +
        "re-derive this scenario before trusting the assertion below",
    ).toBe(STATUS_IDX.done);

    const tones = railTones({ steps, displayIdx: idx, jobStatus: "disputed" });
    const alarms = steps.filter((_, i) => tones[i] === "alarm");
    expect(
      alarms,
      `JobTracking.tsx paints ${alarms.length} steps alarm-red at once on a disputed job ` +
        `sitting on "${steps[idx]}": ${alarms.join(" + ")}. ` +
        `Two dots, one colour, two meanings — the colour stops meaning anything, which is ` +
        `exactly the "Working and Done both red on one card" the owner reported. ` +
        `The two rules collide: \`disputedWorking\` pins Working red wherever the row is, ` +
        `AND \`currentTone\` paints the CURRENT step red under a dispute. Make them ` +
        `exclusive — e.g. skip the disputedWorking pin when Working is not the current ` +
        `step, or drop the pin now that currentTone carries the dispute. ` +
        `(src/components/JobTracking.tsx, the step map at ~1288 and ~1298.)`,
    ).toHaveLength(1);
  });

  it("a healthy rail is green behind, one accent at the cursor, grey ahead", () => {
    // The owner's stated rule, as a set assertion over the whole row.
    const steps = ["assigned", "confirmed", "job_confirmed", "on_the_way", "arrived", "working", "done"] as const;
    const tones = railTones({ steps, displayIdx: 3, jobStatus: "in_progress" });
    expect(tones.slice(0, 3).every((t) => t === "green"), `steps behind the cursor: ${tones.slice(0, 3)}`).toBe(true);
    expect(tones[3], "the current step must be the single accent").toBe("bark");
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
        // An "attention" colour (alarm or amber) marks ONE thing: where the
        // trouble is. More than one in a row means the user cannot tell where.
        const attention = tones.filter((t) => t === "alarm" || t === "amber").length;
        if (attention > 1) {
          collisions.push(
            `status="${jobStatus}", cursor on "${steps[idx]}" → ${attention} attention-coloured ` +
              `steps (${steps.filter((_, i) => tones[i] === "alarm" || tones[i] === "amber").join(", ")})`,
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
