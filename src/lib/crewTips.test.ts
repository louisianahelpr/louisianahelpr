import { describe, expect, it } from "vitest";
import { crewTipsFor } from "./crewTips";

// Q709(c): "Tipped" is per crew member, never per job.
// @mutate src/lib/crewTips.ts |       tipped: tipped.has(`${jobId}:${r.helper_id}`), |       tipped: tipped.size > 0,
// @mutate src/lib/crewTips.ts | r.job_id === jobId && !!r.helper_id | r.job_id === jobId

describe("crewTipsFor", () => {
  const rows = [
    { job_id: "j1", helper_id: "a" },
    { job_id: "j1", helper_id: "b" },
    { job_id: "j1", helper_id: null },
    { job_id: "j2", helper_id: "c" },
  ];
  const names = new Map([["a", "Ana B."], ["b", "Ben C."]]);

  it("one entry per member of THIS crew, in hire order; a deleted account is left out", () => {
    expect(crewTipsFor("j1", rows, names, []).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("tipping one member marks only that member tipped", () => {
    const out = crewTipsFor("j1", rows, names, [{ job_id: "j1", helper_id: "a" }, { job_id: "j2", helper_id: "b" }]);
    expect(out).toEqual([
      { id: "a", name: "Ana B.", tipped: true },
      { id: "b", name: "Ben C.", tipped: false },
    ]);
  });
});
