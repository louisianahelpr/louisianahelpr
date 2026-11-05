/**
 * Q2706 (Builder 3 11-05, lead-approved): the cores read leaves out only job columns NO reader of the posted rows names.
 *
 * get_my_activity_cores' p_job_columns shapes posted_jobs only (application_jobs comes whole from
 * get_jobs_for_my_applications). posted_jobs becomes fetchPostedActivity's postedJobs, read by the Posted tab,
 * NeedsYouBridge (every signed-in page), Home, the job page's poster flows, the Activity dialogs, and every module
 * that patches or reads the activity caches. This guard DERIVES those readers from source:
 *   - every tracked non-test src file that imports hooks/useActivityData or names queryKeys.activity, plus
 *     NeedsYouBridge and activityCores itself,
 *   - then their whole static + dynamic import closure,
 * and fails when any file in it names (word match, comments blanked) a column in POSTED_CORES_UNREAD_COLUMNS.
 * A later change that starts reading one of them turns this red: put the column back in the read.
 *
 * @mutate src/components/job-card/jobStatusLine.ts | sanitizeCancellationReason(job.cancellation_reason); | sanitizeCancellationReason(job.cancellation_reason ?? job.removal_reason);
 * @mutate src/lib/activityCores.ts |   "start_reminder_sent_at",\n]; |   "start_reminder_sent_at", "title",\n];
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";
import { POSTED_CORES_UNREAD_COLUMNS, POSTED_JOB_COLUMNS } from "@/lib/activityCores";
import { JOB_READABLE_COLUMN_LIST } from "@/lib/jobColumns";

const ROOT = resolve(__dirname, "../..");
const isTest = (f: string) => /\.test\.tsx?$/.test(f) || f.startsWith("src/test/");
const code = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = "src/" + spec.slice(2);
  else if (spec.startsWith(".")) base = normalize(join(dirname(from), spec));
  else return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const p = resolve(ROOT, base + ext);
    if (existsSync(p) && statSync(p).isFile() && /\.(ts|tsx|mjs)$/.test(p)) return base + ext;
  }
  return null;
}

/** The files that read the posted rows (derived), then everything they import. */
function readerClosure(): { starts: string[]; files: string[] } {
  const src = trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !isTest(f));
  const starts = src.filter((f) => {
    const c = code(f);
    return /from\s+["']@\/hooks\/useActivityData["']/.test(c) || /\bqueryKeys\.activity\b/.test(c);
  });
  starts.push("src/components/NeedsYouBridge.tsx", "src/hooks/useActivityData.ts");
  const seen = new Set<string>();
  const stack = [...starts];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const m of code(f).matchAll(/(?:import|export)[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const r = resolveImport(f, m[1] ?? m[2]);
      if (r && !isTest(r)) stack.push(r);
    }
  }
  return { starts: [...new Set(starts)], files: [...seen] };
}

// The column lists themselves name every column; they are the read, not a reader.
const LISTS = new Set(["src/lib/activityCores.ts", "src/lib/jobColumns.ts", "src/integrations/supabase/types.ts", "src/boot/activityCoresPrefetch.ts"]);

describe("the posted cores read skips only columns no reader names (Q2706)", () => {
  const { starts, files } = readerClosure();

  it("finds the readers (inventory floor)", () => {
    expect(starts.length).toBeGreaterThan(15);
    expect(files.length).toBeGreaterThan(500);
    for (const f of ["src/pages/posts/PostedJobsTab.tsx", "src/components/NeedsYouBridge.tsx", "src/pages/home/homeDashboard/useNeedsYouTodos.ts", "src/pages/jobs/jobPage/usePosterPageFlows.tsx"]) {
      expect(files, f).toContain(f);
    }
  });

  it("no reader names a skipped column", () => {
    expect(POSTED_CORES_UNREAD_COLUMNS.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const f of files) {
      if (LISTS.has(f)) continue;
      const c = code(f);
      for (const col of POSTED_CORES_UNREAD_COLUMNS) if (new RegExp(`\\b${col}\\b`).test(c)) offenders.push(`${f}: ${col}`);
    }
    expect(offenders).toEqual([]);
  });

  it("skips only real readable columns, and keeps every other one", () => {
    const readable = new Set<string>([...JOB_READABLE_COLUMN_LIST, "materials_note", "onboarding_fee_amount", "poster_marked_done_at"]);
    for (const col of POSTED_CORES_UNREAD_COLUMNS) expect(readable.has(col), col).toBe(true);
    expect(POSTED_JOB_COLUMNS.length).toBe(readable.size - POSTED_CORES_UNREAD_COLUMNS.length);
    for (const col of ["id", "status", "title", "customer_id", "helper_id", "created_at"]) expect(POSTED_JOB_COLUMNS).toContain(col);
  });
});
