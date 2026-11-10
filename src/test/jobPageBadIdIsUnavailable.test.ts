/**
 * Audit 11-10 W2 F270a: /jobs/abc (not a uuid) showed "We couldn't load this job · check your connection" with a
 * Retry, because Postgres rejected `eq("id", "abc")` (22P02) and the query errored. No job can have that id, so the
 * fetch answers null before asking the database and the page shows its "This job isn't available" state.
 *
 * Red on the old code: the fetch reached supabase (here: a client whose `from` throws) and rejected.
 * @mutate src/pages/jobs/jobPage/useJobPage.ts | if (!isJobId(id)) return null; | if (false) return null;
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => { throw new Error("the database was asked about a non-uuid id"); },
    rpc: () => { throw new Error("the database was asked about a non-uuid id"); },
  },
}));

import { fetchJobPage, isJobId } from "@/pages/jobs/jobPage/useJobPage";

describe("job page: a non-uuid id is an unavailable job, not a connection error (F270a)", () => {
  it("isJobId accepts a uuid and refuses words, blanks and near-misses", () => {
    expect(isJobId("3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b")).toBe(true);
    expect(isJobId("3F2A1B4C-5D6E-4F70-8A9B-0C1D2E3F4A5B")).toBe(true);
    for (const bad of ["abc", "", "123", "3f2a1b4c-5d6e-4f70-8a9b", "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b/edit"]) expect(isJobId(bad)).toBe(false);
  });

  it("fetchJobPage('abc') resolves null without asking the database", async () => {
    await expect(fetchJobPage("abc")).resolves.toBeNull();
  });
});
