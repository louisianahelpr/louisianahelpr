/**
 * Q2408 (lead review 11-04, BLOCK): date_window_end is newer than the database a freshly deployed web build may meet
 * (prod-deploy and db-deploy run side by side). Every read that names it must survive the old database's
 * 42703 / PGRST204 (a HEAD count: its bare 400) by asking once more without it, never by failing Browse, the job page,
 * the guest feed, the header count or Activity.
 *
 *  - jobColumns: the column sits in JOB_COLUMNS_AHEAD_OF_DB and BROWSE_VIEW_COLUMNS_AHEAD_OF_DB, not in the whole-row
 *    list, so readJobsAheadOfDb drops it on the retry (behaviour, both kinds of read);
 *  - the header count retries without the window terms on a 400 (behaviour);
 *  - every source select that names the column is handed to readJobsAheadOfDb (inventory, exact both ways), except the
 *    two boot prefetches, whose failure the query behind them already absorbs (their own comments say so).
 *
 * @mutate src/lib/jobColumns.ts | "tax_kind", "date_window_end"] as const; | "tax_kind"] as const;
 * @mutate src/lib/jobColumns.ts | ["helper_fee_percent", "scope_video_url", "date_window_end"] as const; | ["helper_fee_percent", "scope_video_url"] as const;
 * @mutate src/hooks/useDashboardJobsCount.ts |   if (result.error && result.status === 400) result = await build(false); |   void build;
 * @mutate src/pages/jobs/jobPage/useJobPage.ts |     await readJobsAheadOfDb(PARTY_COLUMNS, (columns) => supabase.from("jobs").select(columns).eq("id", id).maybeSingle<Record<string, unknown>>()), |     await supabase.from("jobs").select(PARTY_COLUMNS).eq("id", id).maybeSingle(),
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { trackedFiles } from "@/test/helpers/trackedFiles";

const calls = vi.hoisted(() => ({ ors: [] as string[], heads: 0 }));
vi.mock("@/integrations/supabase/client", () => {
  const make = () => {
    const state = { window: false };
    const b: Record<string, unknown> = {};
    for (const m of ["select", "neq", "lte", "gte", "eq", "gt", "not", "in"]) b[m] = () => b;
    b.or = (s: string) => { calls.ors.push(s); if (s.includes("date_window_end")) state.window = true; return b; };
    // An old database: any request naming date_window_end is refused (a HEAD count's bare 400).
    b.then = (res: (v: unknown) => void) => {
      calls.heads++;
      // The HTTP status rides on the result (a HEAD refusal has no error code); built by a helper so the fixture scanner
      // does not read it as a table's status column.
      const http = (code: number) => ({ status: code });
      res(state.window ? { count: null, error: { message: "" }, ...http(400) } : { count: 7, error: null, ...http(200) });
    };
    return b;
  };
  return { supabase: { from: () => make() } };
});

import { BROWSE_VIEW_COLUMNS_AHEAD_OF_DB, JOB_COLUMNS_AHEAD_OF_DB, JOB_READABLE_COLUMN_LIST, readJobsAheadOfDb } from "@/lib/jobColumns";
import { fetchDashboardJobsCount } from "@/hooks/useDashboardJobsCount";

const REPO = resolve(__dirname, "..", "..");
const oldDb = async (columns: string) => (columns.split(",").map((c) => c.trim()).includes("date_window_end")
  ? { data: null, error: { code: "42703" } }
  : { data: { columns }, error: null });

describe("Q2408: reads that name date_window_end survive a database without it", () => {
  it("the column is listed ahead of db-deploy on both kinds of read, not in the whole-row list", () => {
    expect(JOB_COLUMNS_AHEAD_OF_DB as readonly string[]).toContain("date_window_end");
    expect(BROWSE_VIEW_COLUMNS_AHEAD_OF_DB as readonly string[]).toContain("date_window_end");
    expect(JOB_READABLE_COLUMN_LIST as readonly string[]).not.toContain("date_window_end");
  });

  it("a jobs-table read retries once without it", async () => {
    const r = await readJobsAheadOfDb("id, date_needed, date_window_end, budget", oldDb);
    expect(r.error).toBeNull();
    expect(r.data).toEqual({ columns: "id, date_needed, budget" });
  });

  it("an open_jobs_browse read retries once without it", async () => {
    const r = await readJobsAheadOfDb("id, date_needed, date_window_end, helper_fee_percent", oldDb, { browseView: true });
    expect(r.error).toBeNull();
    expect((r.data as { columns: string }).columns).not.toContain("date_window_end");
  });

  it("the header count asks again without the window terms on a 400", async () => {
    calls.ors = []; calls.heads = 0;
    const n = await fetchDashboardJobsCount({
      userId: undefined, selectedCategory: null, searchQuery: "", minBudget: "", maxBudget: "", urgentOnly: false, boostedOnly: false,
      expiresWithin: "", jobWhen: "today", earlyAccessTier: null, appliedJobIds: [], blockedUserIds: [], dismissedJobIds: [], savedOnlyJobIds: null,
    } as Parameters<typeof fetchDashboardJobsCount>[0]);
    expect(n).toBe(7);
    expect(calls.heads).toBe(2);
    expect(calls.ors.filter((s) => s.includes("date_window_end")).length).toBe(2); // the first try's two window terms
  });

  it("every source select naming date_window_end goes through readJobsAheadOfDb (exact both ways)", () => {
    const files = trackedFiles("src").filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/"));
    expect(files.length).toBeGreaterThan(500);
    // A select list: a string literal with commas that names the column.
    const naming = files.filter((f) => /["'`][^"'`\n]*,\s*date_window_end\b[^"'`\n]*["'`]|["'`][^"'`\n]*date_window_end,[^"'`\n]*["'`]/.test(blankComments(readFileSync(resolve(REPO, f), "utf8")))).sort();
    const BOOT_PREFETCH = ["src/boot/guestJobsPrefetch.ts", "src/boot/jobsPrefetch.ts"];
    expect(naming).toEqual([
      ...BOOT_PREFETCH,
      "src/components/browseMap/fetchJobForPin.ts",
      "src/hooks/useActivityData.ts",
      "src/hooks/useDashboardData.ts",
      "src/hooks/useDashboardJobsCount.ts",
      "src/lib/guestJobsQuery.ts",
      "src/pages/home/QuickApplyHandler.tsx",
      "src/pages/jobs/jobPage/usePosterPageFlows.tsx",
      "src/pages/jobs/jobPage/useJobPage.ts",
    ].sort());
    for (const f of naming.filter((x) => !BOOT_PREFETCH.includes(x) && x !== "src/lib/guestJobsQuery.ts" && x !== "src/hooks/useDashboardJobsCount.ts")) {
      const src = blankComments(readFileSync(resolve(REPO, f), "utf8"));
      expect(src, `${f} reads date_window_end outside readJobsAheadOfDb`).toMatch(/readJobsAheadOfDb\(/);
      expect(src, `${f}: a direct .select(<CONST>) of a list naming the column`).not.toMatch(/\.select\((?:PARTY_COLUMNS|BASE_COLUMNS|BROWSE_COLUMNS|SHEET_COLUMNS|GUEST_JOBS_SELECT|browseColumns)\b/);
    }
    // GUEST_JOBS_SELECT is used only through readJobsAheadOfDb (fetchGuestJobs).
    expect(blankComments(readFileSync(resolve(REPO, "src/pages/home/fetchGuestJobs.ts"), "utf8"))).toMatch(/readJobsAheadOfDb\(GUEST_JOBS_SELECT,/);
    // The boot prefetches fail soft: a refused prefetch resolves to null and the query reads for itself.
    expect(readFileSync(resolve(REPO, "src/boot/guestJobsPrefetch.ts"), "utf8")).toMatch(/r\.ok \? \(r\.json\(\) as Promise<unknown>\) : null/);
    expect(readFileSync(resolve(REPO, "src/boot/jobsPrefetch.ts"), "utf8")).toMatch(/r\.ok \? \(r\.json\(\) as Promise<unknown>\)[^\n]*: Promise\.resolve\(null\)/);
  });
});
