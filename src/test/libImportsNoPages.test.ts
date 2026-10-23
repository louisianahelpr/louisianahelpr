/**
 * THE BOOT CHUNK NEVER IMPORTS SIGNED-IN CODE BACK (2026-10-23, the tracker branch's white screen).
 *
 * vite.config.ts puts src/(lib|hooks|utils|contexts|integrations|config|constants) in the app-shared chunk (the
 * boot path) and the signed-in-only modules (cards, pages, their helpers) in signed-in-shared. When
 * src/lib/jobProgress.ts imported posterFaceAction / helperFaceAction / jobStatusLine at runtime, the two chunks
 * imported each other; in a PRODUCTION build signed-in-shared ran before app-shared had defined its exports, and
 * src/lib/quotes/errors.ts read MAX_JOB_BUDGET_DOLLARS as undefined at module scope: /home stayed on the boot
 * loader ("Cannot read properties of undefined (reading 'toLocaleString')"), measured with vite build + preview in
 * Chromium and WebKit. The dev server (no chunks) never showed it, and the base commit ad23f657bd rendered.
 * The fix moved the tracker's state modules to src/components/tracker (jobProgressState.ts, jobStepFromWait.ts).
 *
 * The class: a RUNTIME import from that shared code into src/components or src/pages. Type-only imports are erased
 * and do not count. The ones that already exist are listed EXACTLY (they predate this guard and the build renders
 * with them, measured 2026-10-23); a new one fails here, and the list only shrinks.
 *
 * @mutate src/lib/jobDate.ts | import { parseLocalDate } from "@/lib/dateUtils"; | import { parseLocalDate } from "@/lib/dateUtils";\nimport { posterFaceAction } from "@/pages/posts/postedJobCard/posterFaceAction";\nvoid posterFaceAction;
 * @mutate src/lib/jobDate.ts | import { parseLocalDate } from "@/lib/dateUtils"; | import { parseLocalDate } from "@/lib/dateUtils";\nimport {\n  posterStatusLine,\n} from "../components/job-card/jobStatusLine";\nvoid posterStatusLine;
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = resolve(__dirname, "..", "..");
const SHARED = ["src/lib", "src/hooks", "src/utils", "src/contexts", "src/integrations", "src/config", "src/constants"];

/** Runtime imports from app-shared code into components/pages that predate this guard (2026-10-23). EXACT. */
// @two-way src/test/libImportsNoPages.test.ts:no runtime import into src/components or src/pages beyond the exact known list
const KNOWN = [
  "src/hooks/useActivityData.ts -> src/components/job-card/trackerMounts",
  "src/hooks/useActivityData.ts -> src/pages/posts/postedJobs/applicantBadge",
  "src/hooks/useDashboardFilters.ts -> src/pages/home/viewerFeedExclusions",
  "src/lib/jobDisplayPay.ts -> src/components/dashboard/JobPrice",
  "src/lib/prePaintShellClasses.ts -> src/components/sidePanelOpen",
];

function walk(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(join(ROOT, dir));
  } catch {
    return [];
  }
  return names.flatMap((n) => {
    const p = join(dir, n);
    if (statSync(join(ROOT, p)).isDirectory()) return walk(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) && !/\.d\.ts$/.test(n) ? [p] : [];
  });
}

function target(file: string, spec: string): string | null {
  const abs = spec.startsWith("@/") ? join("src", spec.slice(2)) : spec.startsWith(".") ? relative(ROOT, resolve(ROOT, dirname(file), spec)) : null;
  if (!abs) return null;
  return /^src\/(components|pages)\//.test(abs) ? abs.replace(/\.(tsx?|js)$/, "") : null;
}

function runtimeImports(file: string): string[] {
  const src = readFileSync(join(ROOT, file), "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(/(?:^|\n)\s*(import|export)\s+(type\s+)?([^;()=]*?)\s+from\s+["']([^"']+)["']/g)) {
    if (m[2]) continue; // import type { ... } / export type { ... }
    const clause = m[3];
    // import { type A, type B } from "...": every specifier type-only, so nothing is imported at runtime.
    const specs = clause.trim().replace(/^\{|\}$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
    if (/^\{[\s\S]*\}$/.test(clause.trim()) && specs.every((s) => /^type\s/.test(s))) continue;
    const t = target(file, m[4]);
    if (t) out.push(`${file} -> ${t}`);
  }
  for (const m of src.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) {
    const t = target(file, m[1]);
    if (t) out.push(`${file} -> ${t}`);
  }
  return out;
}

describe("app-shared code never imports signed-in components or pages at runtime", () => {
  const files = SHARED.flatMap(walk);

  it("reads the real shared tree (floor: 300 files on 2026-10-23)", () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it("no runtime import into src/components or src/pages beyond the exact known list", () => {
    const found = [...new Set(files.flatMap(runtimeImports))].sort();
    expect(found).toEqual([...KNOWN].sort());
  });

  it("the tracker's state modules, which white-screened /home from src/lib, stay out of the shared tree", () => {
    expect(files.filter((f) => /\/(jobProgress|jobProgressState|jobStepFromWait)\.ts$/.test(f))).toEqual([]);
  });
});
