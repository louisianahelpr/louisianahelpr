/**
 * A2-C25 (app audit 2026-10-28, ~/.lh-shots/app-audit-1028/2-jobs/REPORT.md):
 * the AI job builder turned a stated "$40" into $60 on a second run, wrote the
 * description to the poster ("You need a Helpr…"), and ignored "Saturday
 * morning around 9". Now:
 *   - what the poster said wins: their one stated price is both ends of the
 *     budget, their day and start time are kept (sanitize.ts keepStatedFacts,
 *     applied in index.ts to the poster's own turns), and the form fills its
 *     date and time from them (useJobEntry via aiJobDay.ts);
 *   - the prompt tells the model to write in the third person and to keep a
 *     stated price, day and time, and no longer tells it to call the poster "you".
 * Runs the REAL function through the edge harness with the model stubbed to
 * the audit's bad answer ($40-$60, no day, no time).
 *
 * @mutate supabase/functions/ai-job-builder/sanitize.ts |   if (price !== null) {\n    out.budget_min = price; |   if (false) {\n    out.budget_min = price;
 * @mutate supabase/functions/ai-job-builder/sanitize.ts |   const time = statedTime(userText) ?? modelTime; |   const time = modelTime;
 * @mutate supabase/functions/ai-job-builder/sanitize.ts |   if (found.size !== 1) return null; |   if (found.size < 1) return null;
 * @mutate supabase/functions/ai-job-builder/index.ts | the person who posted the job is "the person who posted this job" — never "customer" | the person who posted the job is always "you" or "the person who posted this job" — never "customer"
 * @mutate supabase/functions/ai-job-builder/index.ts | keepStatedFacts(job, answer, turns.filter((t) => t.role === "user") | keepStatedFacts(job, answer, turns.filter((t) => t.role === "assistant")
 * @mutate src/pages/post-job/useJobEntry.ts |     if (day) setDateNeeded(day); |     void day;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetStripeMock } from "./mocks/stripe";
import { blankComments } from "../helpers/blankNonCode";
import { keepStatedFacts, statedDay, statedPrice, statedTime } from "../../../supabase/functions/ai-job-builder/sanitize";
import { aiDayToDate, aiStartTime } from "@/pages/post-job/aiJobDay";

const ASK = "Mow my front and back lawn. $40. Saturday morning around 9";
// The audit's bad answer: the price moved, no day or time, written to the poster.
const BAD = { title: "Lawn mowing", description: "You need a Helpr to mow.", category: "yard_work", estimated_hours: 2, budget_min: 40, budget_max: 60 };

async function run(messages: unknown[]) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(
    JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(BAD) }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  ))));
  const fn = await loadEdgeFunction("ai-job-builder");
  return fn.fetch(fn.request({ headers: { Authorization: "Bearer good" }, body: { messages } }));
}

describe("A2-C25: the AI job builder keeps what the poster said", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    resetEnv();
    scenario.authUser = { id: "u-1", email: "user@test.dev" };
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", ANTHROPIC_API_KEY: "a-key" });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("the stated price, day and time win over the model's answer (the real function)", async () => {
    const res = await run([{ role: "user", content: ASK }]);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ budget_min: 40, budget_max: 40, preferred_day: "saturday", start_time: "09:00" });
  });

  it("only the poster's own turns count, and nothing is invented when they said nothing", async () => {
    const res = await run([
      { role: "user", content: "Mow my lawn" },
      { role: "assistant", content: "Sure, $75 on Friday at 3pm?" },
      { role: "user", content: "Sounds fine" },
    ]);
    const body = await res.json();
    expect(body).toMatchObject({ budget_min: 40, budget_max: 60 });
    expect(body.preferred_day).toBeUndefined();
    expect(body.start_time).toBeUndefined();
  });

  it("reads prices, days and times only when they are plain", () => {
    expect([statedPrice("$40"), statedPrice("40 bucks"), statedPrice("$40 or $50"), statedPrice("$5"), statedPrice("2 hours")]).toEqual([40, 40, null, null, null]);
    expect([statedDay("this saturday"), statedDay("saturday or sunday"), statedDay("tomorrow"), statedDay("whenever")]).toEqual(["saturday", null, "tomorrow", null]);
    expect([statedTime("9:30pm"), statedTime("around 3 in the afternoon"), statedTime("around 9"), statedTime("for 2 hours in the morning"), statedTime("9am or 10am")])
      .toEqual(["21:30", "15:00", null, null, null]);
    // A model time that is not HH:MM is dropped.
    expect(keepStatedFacts({ title: "x" }, { start_time: "9ish", preferred_day: "someday" }, "mow it")).toEqual({ title: "x" });
  });

  it("the form gets the next such day (today counts) and the time as it stores it", () => {
    // 2026-10-29 is a Thursday.
    expect([aiDayToDate("saturday", "2026-10-29"), aiDayToDate("thursday", "2026-10-29"), aiDayToDate("tomorrow", "2026-10-31"), aiDayToDate("none", "2026-10-29")])
      .toEqual(["2026-10-31", "2026-10-29", "2026-11-01", null]);
    expect([aiStartTime("09:00"), aiStartTime("9:00"), aiStartTime(undefined)]).toEqual(["09:00", null, null]);
    const entry = blankComments(readFileSync(join(process.cwd(), "src/pages/post-job/useJobEntry.ts"), "utf8"));
    expect(entry).toContain("if (day) setDateNeeded(day);");
    expect(entry).toContain("setStartTime(time);");
  });

  it("the prompt asks for the third person and the stated facts, and never tells the model to say 'you'", () => {
    const src = readFileSync(join(process.cwd(), "supabase/functions/ai-job-builder/index.ts"), "utf8");
    expect(src.length).toBeGreaterThan(4_000);
    expect(src).toContain("WRITE IN THE THIRD PERSON.");
    expect(src).toContain('never write "You need…"');
    expect(src).toContain("set budget_min and budget_max both\nto exactly that number");
    expect(src).not.toMatch(/always "you"/);
  });
});
