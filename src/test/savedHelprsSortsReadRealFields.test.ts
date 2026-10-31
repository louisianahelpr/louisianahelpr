/**
 * NIGHT-SAVEDS1-SS-6: Saved Helprs offered a "Rating" sort, but get_my_saved_helpers returns no rating, so every row
 * sorted as 0 and the option did nothing. Each sort the screen offers must read a column the newest
 * get_my_saved_helpers returns.
 *
 * @mutate src/components/profile/savedHelpersTab/types.ts |   { value: "recent", label: "Recent activity" }, |   { value: "recent", label: "Recent activity" },\n  { value: "rating" as never, label: "Rating" },
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { sortOptions } from "@/components/profile/savedHelpersTab/types";

const MIG = resolve(__dirname, "../../supabase/migrations");
/** The column each sort reads (useSavedHelpers.ts). A new sort adds its column here. */
const READS: Record<string, string[]> = {
  recent: ["last_job_at", "saved_at"],
  rebooked: ["completed_jobs_together"],
  alpha: ["full_name"],
};

describe("every Saved Helprs sort reads a column the RPC returns", () => {
  const stmt = blankSqlComments(effectiveDefs(MIG).get("get_my_saved_helpers")?.stmt ?? "");
  const returned = new Set(
    [...(/RETURNS\s+TABLE\s*\(([\s\S]*?)\)\s*(?:LANGUAGE|SECURITY|STABLE|SET|AS)/i.exec(stmt)?.[1] ?? "").matchAll(/(\w+)\s+[a-z]/gi)].map((m) => m[1]),
  );

  it("reads the newest definition's columns", () => {
    expect(returned.has("helper_id")).toBe(true);
    expect(returned.size).toBeGreaterThan(8);
  });

  it("each offered sort names its columns, and the RPC returns them", () => {
    expect(sortOptions.length).toBeGreaterThan(2);
    for (const o of sortOptions) {
      const cols = READS[o.value];
      expect(cols, `${o.value}: say which column it sorts by`).toBeTruthy();
      for (const c of cols) expect(returned.has(c), `${o.value} sorts by ${c}`).toBe(true);
    }
  });
});
