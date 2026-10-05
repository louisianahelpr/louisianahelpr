// CLASS GUARD — /home's list, header count and map read ONE live
// viewer-exclusion set at the SAME moment, and all of them re-read after an
// apply.
//
// THE BUG (owner, 2026-10-05, prod, web 1440, a free account that had just
// applied to the only open job): the header said "1 job", the map pinned the
// job and opened its card, and the list said "Nothing today, Lexi." with
// "Post Your First Job". The same report as 2026-09-15 (B1), back again.
//
// WHY THE B1 GUARD DID NOT SEE IT. dashboardSurfaceExclusionParity.test.ts
// checks that every surface MENTIONS every exclusion rule. All three did. The
// defect was WHEN each one read it: the list's applied cull ran inside
// useDashboardData's queryFn and was baked into the fetched — and persisted —
// page, while the count and the map applied the live context set. Two copies
// of "applied" from two moments. Measured in prod edge logs for that session:
// the reload at 18:37:08Z restored the page and the context from the persisted
// cache (no feed or context GET, both inside the 2-minute staleTime), sent the
// count with `id=not.in.(30992c9f…)` only — the context from BEFORE the apply,
// without the job just applied to — and re-ran the map RPC. The list, built
// earlier under the optimistic set, had already dropped the job.
//
// WHAT THIS PINS, each derived from source rather than a hand list:
//   1. The LIST applies every rule in ViewerFeedExclusions AT RENDER (run, not
//      grepped — one fixture per field parsed out of the interface).
//   2. The DATA layer (the queryFn whose output is cached and persisted) bakes
//      in no viewer cull, except the one fail-closed exemption named below.
//   3. A landed apply writes the id into the context and re-reads both the
//      context and the board.
//   4. Every signed-in map on /home is handed the same exclusions AND
//      re-reads its pins when the list re-reads (it used to fetch once per
//      mount, so a hired or applied job's pin outlived the card).
//   5. The header never prints a server total over a list that is complete:
//      "N jobs" above "Nothing today" is impossible by construction.
//
// @mutate src/hooks/useDashboardFilters.ts | if (isJobExcludedForViewer(job, viewerExclusions)) return false; | if (job.id === "__never__") return false;
// @mutate src/pages/home/headerJobCount.ts | if (listComplete) return listedCount; | void listComplete;
// @mutate src/components/browseMap/useMapJobs.ts | }, [currentUserId, reloadNonce, refreshKey]); | }, [currentUserId, reloadNonce]);
// @mutate src/components/BrowseMap.tsx | useMapJobs(currentUserId, refreshKey) | useMapJobs(currentUserId, undefined)
import fs from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { EnrichedJob } from "@/components/dashboard/types";
import { useDashboardFilters } from "@/hooks/useDashboardFilters";
import { headerJobCount } from "@/pages/home/headerJobCount";
import { blankComments } from "@/test/helpers/blankNonCode";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

vi.mock("@/hooks/useUserLocation", () => ({ useUserLocation: () => ({ status: "idle" }) }));
// The count is probed by running it in dashboardSurfaceExclusionParity.test.ts;
// here only the LIST's render-time cull is under test.
vi.mock("@/hooks/useDashboardJobsCount", () => ({
  useDashboardJobsCount: () => ({ data: undefined, isLoading: false }),
}));

const REPO = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");
const code = (rel: string) => blankComments(read(rel));

// ── inventory: the rules, parsed out of the registry interface ──────────────
function exclusionFields(): string[] {
  const src = read("src/pages/home/viewerFeedExclusions.ts");
  const start = src.indexOf("export interface ViewerFeedExclusions {");
  expect(start).toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf("\n}", start));
  return [...new Set([...body.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]))];
}
const FIELDS = exclusionFields();

/**
 * Data-layer culls allowed to ALSO run inside the cached queryFn. Each must be
 * re-applied at render (proven per field by part 1), so the cached copy can
 * only ever hide what the live set hides too.
 */
// @two-way src/test/homeSurfacesReadOneLiveExclusionSet.test.tsx:const staleDataExempt =
const DATA_LAYER_EXEMPT: Record<string, string> = {
  blockedUserIds:
    "Q573: the feed fails CLOSED on blocks — with no context it re-reads the block list " +
    "itself rather than show a blocked poster's jobs. The render layer re-applies the live set.",
};

const OLD_ENOUGH = new Date(Date.now() - 30 * 60 * 1000).toISOString();
const job = (id: string, customer_id: string) =>
  ({
    id, customer_id, title: `Job ${id}`, description: "d", category: "cleaning", budget: 10,
    location: "Abbeville", parish: "Vermilion", date_needed: jobLocalDateISO(2), start_time: "flexible",
    status: "open", is_urgent: false, isBoosted: false, expires_at: null, posterSubscriptionTier: null,
    created_at: OLD_ENOUGH,
  }) as unknown as EnrichedJob;

/** One fixture per rule: each excludes J (poster c-J) and nothing else. */
const FIXTURES: Record<string, Record<string, unknown>> = {
  appliedJobIds: { appliedJobIds: new Set(["J"]) },
  blockedUserIds: { blockedUserIds: new Set(["c-J"]) },
  dismissedJobIds: { dismissedJobIds: new Set(["J"]) },
  savedOnlyJobIds: { savedOnlyJobIds: new Set(["K"]) },
};

function listFor(rule: Record<string, unknown>): string[] {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter><QueryClientProvider client={qc}>{children}</QueryClientProvider></MemoryRouter>
  );
  const { result } = renderHook(
    () => useDashboardFilters({
      allJobs: [job("J", "c-J"), job("K", "c-K")],
      userId: "viewer",
      profile: null,
      helperAvailability: [],
      effectiveFee: 12,
      ...rule,
    } as Parameters<typeof useDashboardFilters>[0]),
    { wrapper },
  );
  return result.current.filteredJobs.map((j) => j.id);
}

describe("1. the list applies every viewer rule at render, from the live set", () => {
  it("parses the rule inventory from the registry", () => {
    expect(FIELDS.length).toBeGreaterThanOrEqual(4);
    expect(FIELDS.filter((f) => !FIXTURES[f]), "a rule with no fixture here").toEqual([]);
  });

  it("keeps both jobs when no rule applies", () => {
    expect(listFor({})).toEqual(expect.arrayContaining(["J", "K"]));
  });

  for (const field of FIELDS) {
    it(`drops the job when ${field} excludes it — the same moment the count and map see it`, () => {
      expect(listFor(FIXTURES[field] ?? {})).toEqual(["K"]);
    });
  }
});

describe("2. the cached/persisted feed page bakes in no viewer cull", () => {
  const data = code("src/hooks/useDashboardData.ts");
  for (const field of FIELDS) {
    it(`useDashboardData's queryFn does not filter by ${field}${DATA_LAYER_EXEMPT[field] ? " — EXEMPT" : ""}`, () => {
      if (DATA_LAYER_EXEMPT[field]) {
        expect(DATA_LAYER_EXEMPT[field].length).toBeGreaterThan(40);
        return;
      }
      expect(
        new RegExp(`\\b${field}\\.has\\(`).test(data),
        `${field} is applied inside the feed's queryFn: that copy is frozen into the cached ` +
          `and persisted page, while the header count and the map read the live set — the ` +
          `"1 job" over "Nothing today" divergence. Apply it in useDashboardFilters instead.`,
      ).toBe(false);
    });
  }
  it("has no stale data-layer exemption", () => {
    // Stale = names no rule any more, or the data layer no longer applies it.
    const staleDataExempt = Object.keys(DATA_LAYER_EXEMPT).filter(
      (k) => !FIELDS.includes(k) || !new RegExp(`\\b${k}\\.has\\(`).test(data),
    );
    expect(staleDataExempt, "stale baseline entry — remove it from DATA_LAYER_EXEMPT").toEqual([]);
  });
});

describe("3. a landed apply re-reads the set every surface uses", () => {
  const src = code("src/pages/home/useApplyFlow.ts");
  const onSuccess = src.slice(src.indexOf("onSuccess:"), src.indexOf("onSettled:"));
  const onSettled = src.slice(src.indexOf("onSettled:"));
  it("writes the applied id into the dashboard context on success", () => {
    expect(onSuccess.length).toBeGreaterThan(100);
    expect(onSuccess).toMatch(/setQueryData[\s\S]{0,120}queryKeys\.dashboard\.context\(\s*vars\.helperId\s*\)/);
    expect(onSuccess).toMatch(/appliedJobIds[\s\S]{0,80}vars\.jobId/);
  });
  it("re-reads the context and the board once it settles", () => {
    expect(onSettled).toMatch(/invalidateQueries/);
    expect(onSettled).toMatch(/"dashboardContext"/);
    expect(onSettled).toMatch(/"dashboardJobs"/);
  });
});

describe("4. every signed-in map on /home gets the same set and re-reads with the list", () => {
  const dirs = ["src/pages/home", "src/components/dashboard"];
  const files = dirs.flatMap((d) =>
    readdirSync(path.join(REPO, d))
      .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f))
      .map((f) => `${d}/${f}`),
  );
  // Every <BrowseMap …/> element, with its props.
  const maps = files.flatMap((f) =>
    [...code(f).matchAll(/<BrowseMap\b([\s\S]*?)\/>/g)].map((m) => ({ file: f, props: m[1] })),
  );
  // Signed-in maps are the ones handed the viewer's exclusions; the guest page
  // (DashboardGuest) has no viewer and is a different route.
  const signedIn = maps.filter((m) => m.file !== "src/pages/home/DashboardGuest.tsx");

  it("finds the /home maps", () => {
    expect(maps.length).toBeGreaterThanOrEqual(3);
    expect(signedIn.length).toBeGreaterThanOrEqual(2);
  });
  it("hands every signed-in map the exclusions and a refresh key", () => {
    const bad = signedIn
      .filter((m) => !/\bexclusions=\{/.test(m.props) || !/\brefreshKey=\{/.test(m.props))
      .map((m) => m.file);
    expect(bad, "a signed-in map without exclusions/refreshKey shows a board the list does not").toEqual([]);
  });
  it("BrowseMap re-runs its pin RPC when the refresh key moves", () => {
    // The pin read lives in browseMap/useMapJobs.ts; BrowseMap must hand it the key.
    expect(code("src/components/BrowseMap.tsx")).toMatch(/useMapJobs\(currentUserId,\s*refreshKey\)/);
    const src = code("src/components/browseMap/useMapJobs.ts");
    const at = src.indexOf('.rpc("get_open_jobs_for_map")');
    expect(at).toBeGreaterThan(-1);
    const deps = /\},\s*\[([^\]]*)\]\);/.exec(src.slice(at))?.[1] ?? "";
    expect(deps.split(",").map((d) => d.trim())).toContain("refreshKey");
  });
});

describe("5. the header never counts what a complete list does not show", () => {
  it("prints the list's own length once every page is loaded", () => {
    expect(headerJobCount({ serverCount: 1, listedCount: 0, listComplete: true })).toBe(0);
    expect(headerJobCount({ serverCount: 3, listedCount: 2, listComplete: true })).toBe(2);
  });
  it("prints the server total while pages remain, the loaded count while it is unknown", () => {
    expect(headerJobCount({ serverCount: 40, listedCount: 25, listComplete: false })).toBe(40);
    expect(headerJobCount({ serverCount: null, listedCount: 25, listComplete: false })).toBe(25);
  });
  it("is what /home's header actually renders", () => {
    const dash = code("src/pages/home/Dashboard.tsx");
    expect(dash).toMatch(/headerJobCount\(\{[\s\S]*listComplete:\s*!hasNextPage/);
    expect(dash).not.toMatch(/\{\s*filters\.totalMatchingCount\s*\?\?\s*filters\.filteredJobs\.length\s*\}/);
  });
});
