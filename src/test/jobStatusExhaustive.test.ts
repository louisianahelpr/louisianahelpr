import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { Constants } from "@/integrations/supabase/types";
import { JOB_STATUS_LABELS } from "@/lib/statusLabels";
import { JOB_STATUS_COLORS, jobStatusColorClasses } from "@/lib/statusColors";
import { assertNever, assertNeverSafe } from "@/lib/assertNever";

/**
 * EVERY JOB STATUS HAS A RENDERING PATH.
 *
 * `pending_approval` fell through every branch of a status switch and rendered
 * an empty bordered box — on jobs the app had just told the poster needed them.
 * It happened TWICE; a second status did the same thing on another card.
 *
 * The permanent fix is a compile-time `never` check, so a missing branch cannot
 * ship: `src/lib/assertNever.ts` (added by this lane) plus one `default:
 * assertNever(status)` per switch. Twelve agents are editing the components
 * that hold those switches right now, so this file does NOT apply it — it lays
 * the groundwork:
 *
 *   1. it proves the helper works, in both its throwing and non-throwing forms;
 *   2. it enumerates the union from its SOURCE OF TRUTH (the generated
 *      `Constants.public.Enums.job_status`, not a hand-written list) and
 *      asserts every canonical map covers every member;
 *   3. it holds the line on the ONE map that is still typed
 *      `Record<string, …>` and is therefore still able to lose a member
 *      silently — which it currently has.
 *
 * The switch/branch sites needing `assertNever` applied are listed in this
 * file's own report block below, with file:line, so the fix can be routed once
 * the component lanes land.
 */

const ROOT = resolve(__dirname, "../..");
const repoFile = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

/** THE source of truth: the runtime array the Supabase type generator emits. */
const JOB_STATUSES = Constants.public.Enums.job_status;

// ---------------------------------------------------------------------------
// 1 — the helper itself
// ---------------------------------------------------------------------------

describe("assertNever", () => {
  it("throws, naming the value and the context, when an impossible case arrives", () => {
    // The runtime half. The COMPILE-TIME half is the point of the helper and is
    // exercised by `npm run typecheck`, not here: `assertNever(status)` in a
    // switch whose union is not fully covered is a build error.
    expect(() => assertNever("pending_approval" as never, "PostedJobCard status")).toThrow(
      /pending_approval.*PostedJobCard status/,
    );
  });

  it("assertNeverSafe reports and falls back instead of blanking a screen", () => {
    const seen: string[] = [];
    const out = assertNeverSafe("open" as never, "fallback", "ctx", (m) => seen.push(m));
    expect(out).toBe("fallback");
    expect(seen[0]).toMatch(/open.*ctx/);
  });

  it("the union it guards is read from the generated types, not retyped", () => {
    // If someone hand-lists the statuses in a test, the test stops tracking the
    // database and starts tracking whoever typed the list.
    expect(
      JOB_STATUSES.length,
      "the generated job_status enum is smaller than 8 — regenerate " +
        "src/integrations/supabase/types.ts (npm run db:types) before trusting anything below",
    ).toBeGreaterThanOrEqual(8);
    expect(JOB_STATUSES).toContain("pending_approval");
  });
});

// ---------------------------------------------------------------------------
// 2 — every canonical map covers every member
// ---------------------------------------------------------------------------

describe("every job status has a rendering path", () => {
  it("has a canonical LABEL", () => {
    const missing = JOB_STATUSES.filter((s) => !JOB_STATUS_LABELS[s]);
    expect(
      missing,
      `job_status values with no entry in JOB_STATUS_LABELS (src/lib/statusLabels.ts): ` +
        `${missing.join(", ")}. A missing label renders as blank or as the raw enum string.`,
    ).toEqual([]);
  });

  it("has a canonical COLOR, and it resolves through the token map", () => {
    const missing = JOB_STATUSES.filter((s) => !JOB_STATUS_COLORS[s]);
    expect(
      missing,
      `job_status values with no entry in JOB_STATUS_COLORS (src/lib/statusColors.ts): ` +
        `${missing.join(", ")}.`,
    ).toEqual([]);
    for (const s of JOB_STATUSES) {
      expect(
        jobStatusColorClasses(s),
        `jobStatusColorClasses("${s}") returned nothing — the chip would paint unstyled`,
      ).toBeTruthy();
    }
  });

  it("the deprecated statusBadge map still covers the whole enum", () => {
    // LIVE DEFECT, reported not fixed (activityConstants.ts is in another lane).
    //
    // `statusBadge` (src/components/activity/activityConstants.ts:81) is typed
    // `Record<string, string>`, and its own doc comment says it is kept only
    // "because the activity-constants test asserts every job_status enum value
    // has a row here". It does not: `pending_approval` has no row, and because
    // the key type is `string` rather than `JobStatus`, TypeScript cannot say
    // so. A consumer reading statusBadge[job.status] for a pending_approval job
    // gets `undefined` and paints an unstyled pill — the same empty-box shape
    // as the original defect, one map over.
    //
    // THE FIX IS A TYPE, NOT A KEY: change the annotation to
    // `Record<JobStatus, string>` and the compiler enumerates the union for you
    // forever. Adding just the missing key leaves the next one to a reviewer.
    const src = repoFile("src/components/activity/activityConstants.ts");
    const block = src.slice(src.indexOf("export const statusBadge"));
    const covered = JOB_STATUSES.filter((s) =>
      new RegExp(`\\b${s}\\s*:`).test(block.slice(0, block.indexOf("};"))),
    );
    const missing = JOB_STATUSES.filter((s) => !covered.includes(s));
    expect(
      missing,
      `statusBadge is missing: ${missing.join(", ")}. It is typed Record<string, string>, ` +
        `so the compiler cannot catch this. Retype it as Record<JobStatus, string> ` +
        `(import { JobStatus } from "@/lib/statusLabels") — that fixes this case and every future one.`,
    ).toEqual([]);
  });

  it("no canonical status map is typed Record<string, …>", () => {
    // The rule behind the finding above. `Record<string, T>` is what turns an
    // exhaustive map into a lookup that can silently miss.
    const offenders: string[] = [];
    for (const file of ["src/lib/statusColors.ts", "src/lib/statusLabels.ts", "src/components/activity/activityConstants.ts"]) {
      const src = repoFile(file);
      for (const m of src.matchAll(
        /export const (\w*[Ss]tatus\w*)\s*:\s*Record<\s*string\s*,/g,
      )) {
        offenders.push(
          `${file}:${src.slice(0, m.index).split("\n").length} — ${m[1]} is ` +
            `Record<string, …>. Key it on JobStatus so a new enum member is a compile error.`,
        );
      }
    }
    expect(offenders, "status maps the compiler cannot check:\n  " + offenders.join("\n  ")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3 — the report: where assertNever still needs applying
// ---------------------------------------------------------------------------

/**
 * SITES NEEDING `assertNever` / an exhaustive `Record<JobStatus, …>`.
 * Each entry is `file:line` plus what is missing. Not fixed here — the files
 * belong to other lanes. The test below keeps the list honest: if a site is
 * fixed, or a new unguarded one appears, it fails and names it.
 */
const NEEDS_EXHAUSTIVE_GUARD: Array<{ site: string; missing: string; note: string }> = [
  {
    site: "src/pages/activity/activityFilters.ts:252",
    missing: "open, accepted, in_progress, revision_requested, pending_approval",
    note:
      "bucketPostedJob's switch handles completed/cancelled/disputed and buckets everything " +
      "else as 'active' via default. The inline comment lists the intended default set and " +
      "does NOT mention pending_approval — it rides the default without anyone having " +
      "decided it should. Give the switch a case per status and end it with assertNever.",
  },
  {
    site: "src/components/activity/activityConstants.ts:81",
    missing: "pending_approval",
    note: "statusBadge: Record<string, string> — retype as Record<JobStatus, string>. LIVE.",
  },
  {
    site: "src/components/profile/ScheduleTab.tsx:57",
    missing: "open, accepted, in_progress, pending_approval",
    note:
      "TERMINAL_ASSIGNED_FILTER: Record<string, string>. The non-terminal statuses route " +
      "elsewhere deliberately; pending_approval is an undocumented omission. Type the map " +
      "on JobStatus with an explicit entry (a documented `null`) per status.",
  },
  {
    site: "src/components/JobTracking.tsx:1298",
    missing: "every status except disputed / revision_requested",
    note:
      "the `currentTone` ternary chain. Everything not disputed/revision_requested silently " +
      "takes the generic bark tone. Lift the chain into a Record<JobStatus, Tone> so the " +
      "colour for a new status is a decision rather than a fallthrough. See also " +
      "src/test/alarmColourInvariant.test.ts, which reports a live two-alarm-dot defect here.",
  },
  {
    site: "src/components/activity/appliedJobCard/appliedJobCardHelpers.ts:33",
    missing: "pending_approval",
    note:
      "deriveAppliedJobCardState builds seven booleans from job.status and never references " +
      "pending_approval — a card in that state satisfies none of them and renders no section. " +
      "This is the empty-bordered-box shape exactly.",
  },
  {
    site: "src/components/activity/PostedJobCard.tsx:97",
    missing: "cancelled, pending_approval",
    note: "showsTracker falls through to false for both; correct for cancelled, undocumented for pending_approval.",
  },
  {
    site: "src/components/profile/WarningsTab.tsx:29",
    missing: "pending_ban_review (violation action_taken, not job_status)",
    note:
      "DIFFERENT union, SAME defect, and it is live: every consequence ladder writes " +
      "action_taken='pending_ban_review' on its top rung and WarningsTab has no branch for " +
      "it, so a user restricted pending a ban decision reads 'Strike 2 of 3 — final warning'. " +
      "Type the action_taken handling as an exhaustive Record and end it with assertNever. " +
      "Asserted in src/test/consequenceCopyParity.test.ts.",
  },
];

describe("the assertNever rollout list stays honest", () => {
  it("every listed site still exists and is still unguarded", () => {
    const stale: string[] = [];
    for (const { site, note } of NEEDS_EXHAUSTIVE_GUARD) {
      const [file] = site.split(":");
      if (!existsSync(resolve(ROOT, file))) {
        stale.push(`${site} — file is gone. Remove the entry. (${note.slice(0, 60)}…)`);
        continue;
      }
      if (/assertNever/.test(repoFile(file))) {
        stale.push(
          `${site} — now uses assertNever. Remove it from NEEDS_EXHAUSTIVE_GUARD so the ` +
            `list keeps meaning "still outstanding".`,
        );
      }
    }
    expect(stale, "the rollout list has drifted:\n  " + stale.join("\n  ")).toEqual([]);
  });

  it("no NEW status switch lands without an exhaustiveness guard", () => {
    // A `switch` whose scrutinee is a status and which leans on `default` is
    // the exact construct that shipped the defect twice. New ones must carry
    // the guard from the start.
    const files = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
      .trim()
      .split("\n")
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f))
      .filter((f) => existsSync(resolve(ROOT, f)));
    const listed = new Set(NEEDS_EXHAUSTIVE_GUARD.map((e) => e.site.split(":")[0]));

    const offenders: string[] = [];
    for (const file of files) {
      if (listed.has(file)) continue;
      const src = readFileSync(resolve(ROOT, file), "utf8");
      for (const m of src.matchAll(/switch\s*\(\s*([\w.?]*\bstatus\b[\w.]*)\s*\)/gi)) {
        const body = src.slice(m.index!, m.index! + 900);
        if (/assertNever/.test(body)) continue;
        // Does it actually branch on job_status literals? A `switch (tone)`
        // that happens to have "status" in the name is not this defect.
        const hits = JOB_STATUSES.filter((s) => body.includes(`"${s}"`)).length;
        if (hits < 2) continue;
        offenders.push(
          `${file}:${src.slice(0, m.index).split("\n").length} — switch (${m[1]}) branches on ` +
            `job_status literals with no assertNever. End it with ` +
            `\`default: return assertNever(${m[1]});\` (src/lib/assertNever.ts) so a new enum ` +
            `member is a build error instead of an empty box, or add it to ` +
            `NEEDS_EXHAUSTIVE_GUARD with the reason it cannot be guarded yet.`,
        );
      }
    }
    expect(offenders, "unguarded status switches:\n  " + offenders.join("\n  ")).toEqual([]);
  });
});
