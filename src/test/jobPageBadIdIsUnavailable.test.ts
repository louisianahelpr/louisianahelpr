/**
 * Audit 11-10 W2 F270a: /jobs/abc (not a uuid) showed "We couldn't load this job · check your connection" with a
 * Retry, because Postgres rejected `eq("id", "abc")` (22P02) and the query errored. No job can have that id, so the
 * fetch reads the 22P02 as "no such job" and resolves null, and the page shows its "This job isn't available" state.
 * Any other error still rejects (a real outage keeps its Retry).
 *
 * Red on the old code: the 22P02 propagated and the fetch rejected.
 * @mutate src/pages/jobs/jobPage/useJobPage.ts | if (isNoSuchJobId(e)) return null; | if (false) return null;
 */
import { describe, expect, it, vi } from "vitest";

const error = { current: { code: "22P02", message: "invalid input syntax for type uuid" } as { code: string; message: string } };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: error.current, status: 400 }) }) }) }),
    rpc: () => { throw new Error("the rpc must not be reached when the id is refused"); },
  },
}));

import { fetchJobPage, isNoSuchJobId } from "@/pages/jobs/jobPage/useJobPage";

describe("job page: a non-uuid id is an unavailable job, not a connection error (F270a)", () => {
  it("isNoSuchJobId recognises Postgres's uuid refusal and nothing else", () => {
    expect(isNoSuchJobId({ code: "22P02" })).toBe(true);
    for (const other of [{ code: "PGRST301" }, { code: "57014" }, {}, null, undefined, new Error("network")]) expect(isNoSuchJobId(other)).toBe(false);
  });

  it("fetchJobPage('abc') resolves null when the database refuses the id", async () => {
    await expect(fetchJobPage("abc")).resolves.toBeNull();
  });

  it("any other database error still rejects, so a real outage keeps its Retry", async () => {
    error.current = { code: "57014", message: "canceling statement due to statement timeout" };
    await expect(fetchJobPage("3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b")).rejects.toThrow(/timeout/);
  });
});
