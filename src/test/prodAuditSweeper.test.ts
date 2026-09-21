import { describe, expect, it } from "vitest";
// @ts-expect-error - plain .mjs tool script, no types
import { candidateJobsQuery, checkCap, HELPER_ID, JOB_TITLE_MARKER, JOB_TITLE_MARKERS, matchesFilter, MATCH_CAP, POSTER_ID, PRESS_TITLE_MARKER, TEST_POSTER_IDS } from "../../scripts/e2e/prod-audit-sweeper.mjs";

type Job = { id: string; title: string; customer_id: string; is_seed: boolean };
const matches = matchesFilter as (j: unknown, marker?: string) => boolean;
const buildQuery = candidateJobsQuery as (marker?: string) => string;
const cap = checkCap as (jobs: unknown[], cap?: number) => unknown[];

const validJob = (overrides: Partial<Job> = {}): Job => ({
  id: "job-1",
  title: "E2E-PRODAUDIT post abcdef",
  customer_id: POSTER_ID as string,
  is_seed: true,
  ...overrides,
});

// @mutate scripts/e2e/prod-audit-sweeper.mjs | "&is_seed=is.true" + |
// @mutate scripts/e2e/prod-audit-sweeper.mjs | export const JOB_TITLE_MARKERS = [JOB_TITLE_MARKER, PRESS_TITLE_MARKER]; | export const JOB_TITLE_MARKERS = [JOB_TITLE_MARKER];
describe("prod-audit-sweeper: candidateJobsQuery", () => {
  it("filters on the BRACKET-FREE marker, not the bracketed harness.ts MARKER", () => {
    // This is the exact defect the sweeper exists to fix: interruptions.spec.ts's
    // post-job test titles rows with JOB_MARKER (brackets stripped, because the
    // post-job form refuses a literal "[...]" as an unfilled placeholder), so a
    // filter on "[E2E-PRODAUDIT]" would match zero real rows.
    expect(JOB_TITLE_MARKER).toBe("E2E-PRODAUDIT");
    const q = buildQuery();
    expect(q).toContain(encodeURIComponent(`*${JOB_TITLE_MARKER}*`));
    expect(q).not.toContain(encodeURIComponent("[E2E-PRODAUDIT]"));
  });

  it("scopes to the shared test poster accounts and is_seed=true", () => {
    const q = buildQuery();
    expect(q).toContain("is_seed=is.true");
    expect(q).toContain(encodeURIComponent(`(${TEST_POSTER_IDS.join(",")})`));
    expect(TEST_POSTER_IDS).toContain(POSTER_ID);
    expect(TEST_POSTER_IDS).toContain(HELPER_ID);
  });
});

/**
 * THE MARKER SET, not just the first marker.
 *
 * Until 2026-09-21 every assertion in this file used the DEFAULT argument, so
 * `JOB_TITLE_MARKERS` and `PRESS_TITLE_MARKER` were never read by any test:
 * dropping the press marker from the list — which is what strands the
 * press-every-control fixtures nothing else can delete (26 of them had piled up
 * on prod by 2026-09-19, one per shard per night) — left this guard GREEN
 * (12 passed). A sweeper is only as good as the set of residue it looks for.
 */
describe("prod-audit-sweeper: the marker set", () => {
  it("sweeps the press harness's residue as well as prod-audit's", () => {
    expect(PRESS_TITLE_MARKER).toBe("PRESS DO NOT ACCEPT");
    expect(JOB_TITLE_MARKERS).toEqual([JOB_TITLE_MARKER, PRESS_TITLE_MARKER]);
  });

  it("every marker gets its own scoped query and its own client-side re-check", () => {
    expect((JOB_TITLE_MARKERS as string[]).length).toBeGreaterThanOrEqual(2);
    for (const marker of JOB_TITLE_MARKERS as string[]) {
      // Bracket-free, so the bracketed form (which CONTAINS it) matches too.
      expect(marker).not.toMatch(/[[\]]/);
      const q = buildQuery(marker);
      expect(q).toContain(encodeURIComponent(`*${marker}*`));
      expect(q).toContain("is_seed=is.true");
      expect(q).toContain(encodeURIComponent(`(${TEST_POSTER_IDS.join(",")})`));
      expect(matches(validJob({ title: `[${marker}] leftover` }), marker)).toBe(true);
      expect(matches(validJob({ title: "Fix my fence" }), marker)).toBe(false);
      expect(matches(validJob({ title: `${marker} leftover`, is_seed: false }), marker)).toBe(false);
    }
  });
});

describe("prod-audit-sweeper: matchesFilter", () => {
  it("matches a job titled with the bracket-free marker (the real shape on prod)", () => {
    expect(matches(validJob())).toBe(true);
  });

  it("also matches a title that happens to still carry the brackets (superset, never narrower)", () => {
    expect(matches(validJob({ title: "[E2E-PRODAUDIT] post abcdef" }))).toBe(true);
  });

  it("rejects a title without the marker at all", () => {
    expect(matches(validJob({ title: "Fix my fence" }))).toBe(false);
  });

  it("rejects a customer_id outside the shared test poster accounts", () => {
    expect(matches(validJob({ customer_id: "00000000-0000-4000-8000-000000000000" }))).toBe(false);
  });

  it("accepts the helper account as customer_id too", () => {
    expect(matches(validJob({ customer_id: HELPER_ID as string }))).toBe(true);
  });

  it("rejects a non-seed row even if the title and account match", () => {
    expect(matches(validJob({ is_seed: false }))).toBe(false);
  });

  it("rejects null/undefined without throwing", () => {
    expect(matches(null)).toBe(false);
    expect(matches(undefined)).toBe(false);
  });
});

describe("prod-audit-sweeper: checkCap", () => {
  it("passes through at or under the cap", () => {
    const jobs = Array.from({ length: MATCH_CAP as number }, (_, i) => validJob({ id: `job-${i}` }));
    expect(cap(jobs)).toBe(jobs);
  });

  it("throws over the cap, without deleting anything (the caller never proceeds past this)", () => {
    const jobs = Array.from({ length: (MATCH_CAP as number) + 1 }, (_, i) => validJob({ id: `job-${i}` }));
    expect(() => cap(jobs)).toThrow(/hard cap/i);
  });

  it("the default cap is exactly 50, matching the spec", () => {
    expect(MATCH_CAP).toBe(50);
  });
});
