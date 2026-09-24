/**
 * N-007: notify_helpers_on_job_post re-notified the whole parish every time a
 * funded job re-entered 'open', with no per-Helpr cooldown. The newest
 * migration defining it must keep both candidate predicates: once per
 * (job, Helpr), and an hourly per-Helpr cap.
 *
 * @mutate supabase/migrations/20260924063801_parish_fanout_dedupe_and_cap.sql | )  -- N-007 once per job | ) OR true  -- N-007 once per job
 * @mutate supabase/migrations/20260924063801_parish_fanout_dedupe_and_cap.sql | ) < 10  -- N-007 hourly cap | ) >= 0  -- N-007 hourly cap
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "supabase/migrations";
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const defining = files.filter((f) => /FUNCTION public\.notify_helpers_on_job_post\(/.test(readFileSync(`${DIR}/${f}`, "utf8")));
const newest = defining.length ? readFileSync(`${DIR}/${defining[defining.length - 1]}`, "utf8") : "";

describe("the parish job-match fan-out is bounded (N-007)", () => {
  it("the inventory is real", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(defining.length).toBeGreaterThan(1);
  });
  it("skips a Helpr already told about this job", () => {
    expect(newest).toMatch(/AND NOT EXISTS \(\s*SELECT 1 FROM public\.notifications n\s+WHERE n\.user_id = c\.user_id AND n\.job_id = NEW\.id AND n\.type = 'job_match'\s*\)  -- N-007 once per job/);
  });
  it("caps job_match notifications per Helpr per hour", () => {
    expect(newest).toMatch(/n\.created_at > now\(\) - interval '1 hour'\s*\) < 10  -- N-007 hourly cap/);
  });
});
