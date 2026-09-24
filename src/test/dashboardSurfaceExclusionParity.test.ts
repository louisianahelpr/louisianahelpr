// CLASS GUARD — every /home surface that COUNTS or SHOWS open jobs must
// apply the same viewer-local exclusions.
//
// THE CLASS, from the owner's own reports:
//   2026-09-15  "1 job" in the header, map pinned it, list said "Nothing
//               today."  →  `appliedJobIds` reached the feed and nothing else.
//   2026-09-19  "map shows 7 jobs. list shows 4."
//               →  `dismissedJobIds` reached BrowseTasksFeed and nothing else.
//
// Both were the SAME defect wearing a different field name, and the guard
// written for the first one could not see the second: it asserted that the
// count matched the list *for the applied-job cull*, which is a statement
// about one rule, not about the class. A guard for the class has to fail for
// a rule that does not exist yet.
//
// HOW THIS ONE DOES THAT. Nothing here is a hand-kept list of rules:
//   1. The INVENTORY of exclusion rules is parsed out of the
//      `ViewerFeedExclusions` interface in
//      src/pages/home/viewerFeedExclusions.ts. Add a field there and it
//      appears here on the next run, un-evidenced, and this file goes red
//      naming the surfaces that have not been taught about it.
//   2. The INVENTORY of surfaces is derived from the WORLD, not declared:
//      we walk /home's own import graph and find every module that reads
//      an open-job source (`open_jobs_browse` or `get_open_jobs_for_map`).
//      A fourth surface appearing on this screen fails the test until it is
//      given a chain and its evidence.
//   3. Each (surface, rule) pair needs EVIDENCE in that surface's source, or
//      an exemption with a written reason. There is exactly one exemption and
//      it is a privacy guarantee, not an oversight.
//
// Behavioural proof that the evidence is real lives beside each surface:
// src/hooks/useDashboardJobsCount.test.tsx (the count's own numbers move) and
// src/components/BrowseMap.test.tsx (pins actually disappear). This file is
// the completeness half — "no rule is missing from any surface."
//
// @mutate src/hooks/useDashboardJobsCount.ts | query = query.not("id", "in", `(${dismissedJobIds.join(",")})`); | void dismissedJobIds;
// @mutate src/components/BrowseMap.tsx | return filtered.filter((j) => !isJobExcludedForViewer(j, exclusions)); | return filtered;
// @mutate src/pages/home/viewerFeedExclusions.ts | if (x.dismissedJobIds.has(job.id)) return true; | if (false) return true;

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import {
  EMPTY_VIEWER_FEED_EXCLUSIONS,
  isJobExcludedForViewer,
  type ViewerFeedExclusions,
} from "@/pages/home/viewerFeedExclusions";
import { useDashboardJobsCount } from "@/hooks/useDashboardJobsCount";

// ── A PostgREST-shaped stub that really narrows ────────────────────────────
// The count surface is probed BEHAVIOURALLY below, not by looking for its
// field names in the source: a mutation that deletes the `.not("id","in",…)`
// line leaves the identifier behind in the interface and the destructure, so
// a text oracle stays green over a count that no longer culls anything. Only
// the number moving proves the rule is applied.
const COUNT_ROWS = [
  { id: "j-1", customer_id: "c-1" },
  { id: "j-2", customer_id: "c-2" },
  { id: "j-3", customer_id: "c-3" },
];

function makeCountBuilder() {
  let rows = [...COUNT_ROWS];
  const b: Record<string, unknown> = {};
  for (const m of ["select", "neq", "or", "lte", "eq", "gte", "gt"]) b[m] = () => b;
  b.not = (col: string, op: string, val: string) => {
    if (op === "in") {
      const ids = new Set(val.slice(1, -1).split(",").filter(Boolean));
      rows = rows.filter((r) => !ids.has((r as Record<string, string>)[col]));
    }
    return b;
  };
  b.in = (col: string, vals: string[]) => {
    const keep = new Set(vals);
    rows = rows.filter((r) => keep.has((r as Record<string, string>)[col]));
    return b;
  };
  b.then = (resolve: (v: { count: number; error: null }) => void) =>
    resolve({ count: rows.length, error: null });
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => makeCountBuilder() },
}));

/** Run the REAL count hook for a given exclusion set and return its number. */
async function countFor(x: ViewerFeedExclusions): Promise<number> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(
    () =>
      useDashboardJobsCount({
        userId: undefined,
        selectedCategory: null,
        searchQuery: "",
        minBudget: "",
        maxBudget: "",
        urgentOnly: false,
        boostedOnly: false,
        expiresWithin: "",
        earlyAccessTier: null,
        appliedJobIds: [...x.appliedJobIds],
        blockedUserIds: [...x.blockedUserIds],
        dismissedJobIds: [...x.dismissedJobIds],
        savedOnlyJobIds: x.savedOnlyJobIds === null ? null : [...x.savedOnlyJobIds],
      }),
    {
      wrapper: ({ children }) =>
        createElement(QueryClientProvider, { client: queryClient }, children),
    },
  );
  await waitFor(() => expect(result.current.data).toBeTypeOf("number"));
  return result.current.data as number;
}

const REPO = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(REPO, rel));

const REGISTRY = "src/pages/home/viewerFeedExclusions.ts";
const DASHBOARD_ENTRY = "src/pages/home/Dashboard.tsx";

/**
 * The two things a /home surface can read the open-job board from —
 * matched at the CALL, not as a substring, so a mention in a comment or in
 * the generated types file is not mistaken for a surface.
 */
const OPEN_JOB_READS = [
  /\.from\(\s*["']open_jobs_browse["']\s*\)/,
  /\.rpc\(\s*["']get_open_jobs_for_map["']\s*\)/,
];

/**
 * A read narrowed to ONE job (`.eq("id", …).maybeSingle()`) is a lookup, not a
 * board: opening a tapped pin, resolving a `?quickApply=` deep link. It counts
 * and shows nothing, so the exclusions do not apply to it — the surface that
 * offered the id already applied them. Classified, not ignored: the test below
 * asserts this bucket is non-empty, so the classifier cannot quietly swallow a
 * real surface.
 */
const SINGLE_ROW_READ = /\.(maybeSingle|single)\(\)/;

// ── 1. Inventory of RULES — parsed from the interface, never listed here ────
function exclusionFields(): string[] {
  const src = read(REGISTRY);
  const start = src.indexOf("export interface ViewerFeedExclusions {");
  expect(start, `${REGISTRY} must declare "export interface ViewerFeedExclusions"`).toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf("\n}", start));
  // Field declarations only: `name: Type;` at one indent level, comments and
  // JSDoc skipped by the leading-whitespace + colon shape.
  const fields = [...body.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
  return [...new Set(fields)];
}

// ── 2. Inventory of SURFACES — walked out of the dashboard's import graph ───
function resolveImport(spec: string, fromRel: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.posix.join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  else return null;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (exists(base + ext)) return base + ext;
  }
  return exists(base) && /\.tsx?$/.test(base) ? base : null;
}

/**
 * Another PAGE is another screen, not part of this one. `/browse`
 * (DashboardGuest) and `/jobs/:id` (JobDetail) each read the same view and
 * each answer for themselves; walking into them would make this guard about
 * the whole app. A page is a file App.tsx routes to; Dashboard's OWN pieces in
 * src/pages/home/ are not a page boundary and are still walked.
 */
const ROUTED_PAGES = new Set(
  [...read("src/App.tsx").matchAll(/import\(\s*["']\.\/(pages\/[^"']+)["']\s*\)/g)].map((m) => `src/${m[1]}.tsx`),
);
const isOtherPage = (rel: string) => rel !== DASHBOARD_ENTRY && ROUTED_PAGES.has(rel);

/** Every non-test module reachable from /home, this screen only. */
function dashboardImportGraph(): string[] {
  const seen = new Set<string>();
  const queue = [DASHBOARD_ENTRY];
  while (queue.length) {
    const rel = queue.shift()!;
    if (seen.has(rel) || /\.test\.tsx?$/.test(rel) || isOtherPage(rel)) continue;
    seen.add(rel);
    const src = read(rel);
    // static `from "…"` plus the lazy `import("…")` the map is loaded through.
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const next = resolveImport(m[1], rel);
      if (next) queue.push(next);
    }
  }
  return [...seen].sort();
}

/**
 * Surface chains. The FILES are declared; which files must be covered is not —
 * step 2b below diffs these against what the import walk actually found, so a
 * new open-job reader on this screen cannot go unnoticed.
 */
const SURFACE_CHAINS: Record<string, string[]> = {
  list: [
    "src/hooks/useDashboardData.ts",
    "src/hooks/useDashboardFilters.ts",
    "src/components/dashboard/BrowseTasksFeed.tsx",
  ],
  count: ["src/hooks/useDashboardJobsCount.ts"],
  map: ["src/components/BrowseMap.tsx", "src/components/browseMap/mapFilter.ts"],
};

/**
 * What counts as a surface honouring a rule. A regex per (surface, rule):
 * a rule with no entry is UNEVIDENCED and fails, which is exactly what
 * happens the moment a new field is added to the registry.
 *
 * `null` = exempt, and every exemption carries its reason in EXEMPTIONS.
 */
// @two-way src/test/dashboardSurfaceExclusionParity.test.ts:const staleExemptions =
const EXEMPTIONS: Record<string, string> = {
  "map:blockedUserIds":
    "get_open_jobs_for_map deliberately omits customer_id (the PII-safe row), " +
    "so the map has no field to match a blocked poster on. Widening the RPC to " +
    "close this gap is forbidden — the privacy guarantee outranks a pin count " +
    "that is off by one blocked poster's open jobs.",
};

/**
 * The fact behind each exemption, as a probe that is TRUE while it still holds.
 * An EXEMPTIONS key with no probe, or whose probe is false, is stale.
 */
const EXEMPTION_STILL_HOLDS: Record<string, () => boolean> = {
  // The newest get_open_jobs_for_map still returns no customer_id column.
  "map:blockedUserIds": () => {
    const dir = path.join(REPO, "supabase/migrations");
    const newest = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
      .filter((src) => /FUNCTION\s+public\.get_open_jobs_for_map\s*\(/i.test(src))
      .pop();
    if (!newest) return false;
    const def = newest.slice(newest.search(/FUNCTION\s+public\.get_open_jobs_for_map\s*\(/i));
    const returns = /RETURNS\s+TABLE\s*\(([\s\S]*?)\)\s*\n/i.exec(def)?.[1] ?? "";
    return returns.length > 0 && !/\bcustomer_id\b/.test(returns);
  },
};

/**
 * A surface honours a rule if its chain either names the field outright, or
 * routes the whole registry object through the shared predicate (which is
 * itself proven complete, per-field, by the first describe block below).
 */
function honours(surface: string, field: string): boolean {
  const chain = SURFACE_CHAINS[surface].map(read).join("\n");
  if (chain.includes(field)) return true;
  return /isJobExcludedForViewer\s*\(/.test(chain) && /ViewerFeedExclusions/.test(chain);
}

// One fixture per rule, keyed by field name. Every fixture excludes j-1 and
// only j-1 out of COUNT_ROWS, so a surface honouring the rule answers 2 where
// an unfiltered one answers 3. A rule with no fixture fails the coverage
// assertion below rather than being quietly skipped.
const JOB = { id: "j-1", customer_id: "c-1" };
const FIXTURES: Record<string, Partial<ViewerFeedExclusions>> = {
  appliedJobIds: { appliedJobIds: new Set(["j-1"]) },
  blockedUserIds: { blockedUserIds: new Set(["c-1"]) },
  dismissedJobIds: { dismissedJobIds: new Set(["j-1"]) },
  savedOnlyJobIds: { savedOnlyJobIds: new Set(["j-2", "j-3"]) },
};
const withRule = (field: string): ViewerFeedExclusions => ({
  ...EMPTY_VIEWER_FEED_EXCLUSIONS,
  ...FIXTURES[field],
});

describe("viewer-feed exclusions — the shared predicate is complete", () => {
  const FIELDS = exclusionFields();

  // Non-empty floor. Four rules exist today; a parse that silently returned
  // [] would make every assertion below vacuously green.
  it("parses a non-empty rule inventory out of the registry", () => {
    expect(FIELDS.length).toBeGreaterThanOrEqual(4);
    expect(FIELDS).toContain("appliedJobIds");
    expect(FIELDS).toContain("dismissedJobIds");
  });

  it("has a fixture for every rule in the inventory", () => {
    expect(FIELDS.filter((f) => !(f in FIXTURES))).toEqual([]);
  });

  it("keeps a job no rule excludes", () => {
    expect(isJobExcludedForViewer(JOB, EMPTY_VIEWER_FEED_EXCLUSIONS)).toBe(false);
  });

  for (const field of FIELDS) {
    it(`excludes the job when ${field} says so`, () => {
      expect(isJobExcludedForViewer(JOB, withRule(field))).toBe(true);
    });
  }

  it("treats an EMPTY savedOnlyJobIds as zero matches, not as 'no filter'", () => {
    // The distinction that makes "Only saved" honest when nothing is saved.
    const x = { ...EMPTY_VIEWER_FEED_EXCLUSIONS, savedOnlyJobIds: new Set<string>() };
    expect(isJobExcludedForViewer(JOB, x)).toBe(true);
  });
});

describe("every /home open-job surface applies every exclusion rule", () => {
  const FIELDS = exclusionFields();
  const GRAPH = dashboardImportGraph();

  it("walks a real import graph off /home", () => {
    // Floor: without this the readers scan below could find nothing and the
    // coverage diff would pass on an empty world.
    expect(GRAPH.length).toBeGreaterThan(50);
    expect(GRAPH).toContain("src/hooks/useDashboardJobsCount.ts");
  });

  // 2b. World → declaration diff. Every module on this screen that reads an
  // open-job source must belong to a declared surface chain.
  it("knows about every module on this screen that reads the open-job board", () => {
    const boards: string[] = [];
    const lookups: string[] = [];
    for (const rel of GRAPH) {
      const src = read(rel);
      if (!OPEN_JOB_READS.some((re) => re.test(src))) continue;
      (SINGLE_ROW_READ.test(src) ? lookups : boards).push(rel);
    }
    // Floors on BOTH buckets: an empty board list would pass the diff below
    // vacuously, and an empty lookup list would mean the classifier is dead.
    expect(boards.length).toBeGreaterThanOrEqual(2);
    expect(lookups.length).toBeGreaterThanOrEqual(1);
    const readers = boards;

    const declared = new Set(Object.values(SURFACE_CHAINS).flat());
    const undeclared = readers.filter((r) => !declared.has(r));
    expect(
      undeclared,
      "a new /home surface reads the open-job board but is not in " +
        "SURFACE_CHAINS — give it a chain and evidence for every exclusion rule",
    ).toEqual([]);
  });

  it("declares only chain files that exist", () => {
    const missing = Object.values(SURFACE_CHAINS).flat().filter((f) => !exists(f));
    expect(missing).toEqual([]);
  });

  for (const surface of Object.keys(SURFACE_CHAINS)) {
    for (const field of FIELDS) {
      const key = `${surface}:${field}`;
      const reason = EXEMPTIONS[key];
      it(`${surface} honours ${field}${reason ? " — EXEMPT" : ""}`, async () => {
        if (reason) {
          // An exemption must say why, at length. A one-word reason is how an
          // oversight gets filed as a decision.
          expect(reason.length).toBeGreaterThan(40);
          return;
        }
        // The count surface is probed by RUNNING it: source text cannot tell
        // a live `NOT IN` from a leftover identifier. The other two carry
        // their behavioural halves in their own test files (BrowseMap.test.tsx
        // and useDashboardFilters.test.tsx); here they are checked for the
        // wiring that makes the rule reach them at all.
        if (surface === "count") {
          const baseline = await countFor(EMPTY_VIEWER_FEED_EXCLUSIONS);
          expect(baseline).toBe(COUNT_ROWS.length);
          const narrowed = await countFor(withRule(field));
          expect(
            narrowed,
            `the header count does not move when ${field} excludes a job — it ` +
              `would print ${baseline} over a list of ${narrowed}.`,
          ).toBeLessThan(baseline);
          return;
        }
        expect(
          honours(surface, field),
          `the ${surface} surface (${SURFACE_CHAINS[surface].join(", ")}) never ` +
            `mentions "${field}" and does not route ViewerFeedExclusions through ` +
            `isJobExcludedForViewer — so it counts/shows jobs the other surfaces hide. ` +
            `Either apply the rule there or add "${key}" to EXEMPTIONS with a reason.`,
        ).toBe(true);
      });
    }
  }

  // The exemption table is not a place to park work: every key in it must
  // name a surface and a rule that actually exist.
  it("has no stale exemptions", () => {
    const valid = new Set(
      Object.keys(SURFACE_CHAINS).flatMap((s) => FIELDS.map((f) => `${s}:${f}`)),
    );
    expect(Object.keys(EXEMPTIONS).filter((k) => !valid.has(k))).toEqual([]);
    // TWO-WAY: every exemption carries a probe of the fact that justifies it,
    // and an exemption whose fact no longer holds is stale. (honours() is a
    // TEXT proxy and cannot be used for this: BrowseMap routes the whole
    // exclusions object through the shared predicate and says blockedUserIds
    // in a comment, so honours("map", "blockedUserIds") is true while the
    // rows it filters carry no customer_id to match on.)
    const staleExemptions = Object.keys(EXEMPTIONS).filter((k) => {
      const probe = EXEMPTION_STILL_HOLDS[k];
      return !probe || !probe();
    });
    expect(staleExemptions.map((k) => `stale baseline entry ${k} — remove it (lower the baseline)`)).toEqual([]);
  });
});
