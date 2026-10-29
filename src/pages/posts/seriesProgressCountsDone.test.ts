/**
 * A2-C42 (audit 2026-10-29, aa9-rh-*; lead decision 2026-10-29): the poster's series strip read "1/4 visits"
 * before any visit happened (1 = visit rows created, the parent counts as one). Now "4 visits" until a visit is
 * done, then "2 of 4 done", counted from COMPLETED visit rows, never from rows created.
 *
 * @mutate src/pages/posts/SeriesStrip.tsx |   return done > 0 ? `${Math.min(done, total)} of ${total} done` : `${total} visit${total === 1 ? "" : "s"}`; |   return `${done}/${total} visits`;
 * @mutate src/pages/posts/SeriesStrip.tsx |         .eq("status", "completed"); |         ;
 * @mutate src/pages/posts/SeriesStrip.tsx | {" · "}{seriesProgress(doneCount ?? 0, total)} | {" · "}{seriesProgress(createdVisits, total)}
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { seriesProgress } from "./SeriesStrip";

describe("the series strip counts visits done, not rows created (A2-C42)", () => {
  it("before any visit: the size of the series only", () => {
    expect(seriesProgress(0, 4)).toBe("4 visits");
    expect(seriesProgress(0, 1)).toBe("1 visit");
  });

  it("after visits: how many are done", () => {
    expect(seriesProgress(2, 4)).toBe("2 of 4 done");
    expect(seriesProgress(5, 4)).toBe("4 of 4 done");
  });

  it("done is read from completed visit rows (the parent and its children), and that is what the strip prints", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "SeriesStrip.tsx"), "utf8"));
    expect(src).toMatch(/\.or\(`id\.eq\.\$\{jobId\},parent_job_id\.eq\.\$\{jobId\}`\)\s*\.eq\("status", "completed"\)/);
    expect(src).toMatch(/seriesProgress\(doneCount \?\? 0, total\)/);
  });
});
