/**
 * A METERED RUN PACES ITSELF UNDER ITS PER-MINUTE CEILING (docs/OPEN.md Q104;
 * nightly-red #1754 prod-audit, #1742 e2e-real-backend).
 *
 * The budget step judges each run by its busiest wall-clock minute. Measured
 * on CI: prod-audit 871 (run 36069316906) and 751 (36003051878) against the
 * 400/min ceiling; its `profile-title-alignment` spec ALONE, the only two
 * tests of dispatch 36095495499, sent 836 requests with 707 in one minute (27
 * Profile surfaces per width, back to back); e2e-real-backend's authenticated
 * leg 929 (35987836495) and 857 (35984980556), 1,282 requests in 1.2 minutes.
 * Every one of those runs had its tests pass or fail on their own merits and
 * then went red on the budget step.
 *
 * So e2e/requestMeter.mjs gates every `page.goto` / `page.reload` and every
 * test start of a metered run (e2e/prodTest.ts) on the same minute buckets
 * the budget step reads. This drives that gate with a fake clock through the
 * load the profile spec measured, and proves the same load UNGATED breaks the
 * ceiling, so the scenario is a real one.
 *
 * @mutate e2e/requestMeter.mjs | if (used + this.reserve <= this.ceiling) break; | break;
 * @mutate e2e/requestMeter.mjs | const used = (this.minutes[m] \|\| 0) + (this.prior[m] \|\| 0); | const used = this.minutes[m] \|\| 0;
 * @mutate e2e/requestMeter.mjs |       page[name] = async (...args) => { |       page[`${name}Unpaced`] = async (...args) => {
 * @mutate e2e/prodTest.ts | meter.paceTo(ceilingFor(label), { workers: workerInfo.config.workers }); | void ceilingFor;
 * @mutate e2e/prodTest.ts | if (running.timeout > 0) running.setTimeout(running.timeout + ms); | void running;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { RequestMeter, ceilingFor } from "../../e2e/requestMeter.mjs";
import { aggregate } from "../../scripts/e2e/request-budget.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const URL = "https://fncmgoasalhdgfwzhsqa.supabase.co/rest/v1/profiles?select=*";

/** A clock the meter reads and sleeps on, so an hour of pacing runs in milliseconds. */
function fakeClock(start: number) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/**
 * The profile-title-alignment load: 2 widths x 28 navigations, each sending 15
 * backend requests over ~1.3 s (the page boot plus the spec's 900 ms settle).
 * 56 x 15 = 840, the 836 dispatch 36095495499 measured.
 */
async function profileSpecLoad(meter: RequestMeter, clock: ReturnType<typeof fakeClock>, gated: boolean) {
  const page = meter.pacePage({ goto: async () => undefined, reload: async () => undefined });
  for (let nav = 0; nav < 56; nav++) {
    if (gated) await page.goto();
    for (let r = 0; r < 15; r++) {
      meter.record(URL, "GET", clock.now());
      clock.advance(1300 / 15);
    }
  }
}

const peak = (m: RequestMeter) => Math.max(...Object.values(m.minutes));

describe("the request meter paces a run under its ceiling", () => {
  const CEILING = ceilingFor("prod-audit");

  it("reads a real ceiling for the label", () => {
    expect(CEILING).toBeGreaterThan(0);
    expect(() => ceilingFor("prod-audit", join(ROOT, "package.json"))).toThrow(/no ceilingPerMinute/);
  });

  it("the profile spec's load, ungated, breaks the ceiling (the nightly's red)", async () => {
    const clock = fakeClock(1_790_000_000_000);
    const meter = new RequestMeter("prod-audit").paceTo(CEILING, { prior: {}, now: clock.now, sleep: clock.sleep });
    await profileSpecLoad(meter, clock, false);
    expect(meter.total).toBe(840);
    expect(peak(meter)).toBeGreaterThan(CEILING);
  });

  it("the same load through the gated goto never puts more than the ceiling in one minute", async () => {
    const clock = fakeClock(1_790_000_000_000);
    const meter = new RequestMeter("prod-audit").paceTo(CEILING, { prior: {}, now: clock.now, sleep: clock.sleep });
    const holds: number[] = [];
    meter.onPaceWait = (ms) => holds.push(ms);
    await profileSpecLoad(meter, clock, true);
    expect(meter.total, "pacing holds requests, it never drops them").toBe(840);
    expect(peak(meter)).toBeLessThanOrEqual(CEILING);
    expect(holds.length, "the gate held at least once").toBeGreaterThan(0);
    expect(meter.paceWaitMs).toBe(holds.reduce((a, b) => a + b, 0));
    // The budget step sees the same numbers the gate paced on.
    const agg = aggregate([meter.toJSON()])["prod-audit"];
    expect(agg.peakPerMinute).toBeLessThanOrEqual(CEILING);
    expect(agg.paceWaitMs).toBe(meter.paceWaitMs);
  });

  it("an earlier process of the same label counts against the minute", async () => {
    const clock = fakeClock(1_790_000_000_000);
    const minute = Math.floor(clock.now() / 60_000);
    const meter = new RequestMeter("chromium").paceTo(CEILING, {
      prior: { [minute]: CEILING - 10 },
      now: clock.now,
      sleep: clock.sleep,
    });
    const held = await meter.pace();
    expect(held, "a minute the previous step filled is not reused").toBeGreaterThan(0);
    expect(Math.floor(clock.now() / 60_000)).toBe(minute + 1);
  });

  it("workers share the ceiling", () => {
    const meter = new RequestMeter("chromium").paceTo(400, { workers: 2, prior: {} });
    expect(meter.ceiling).toBe(200);
  });

  it("pacing is off unless a run turns it on (the node scripts measure without it)", async () => {
    const meter = new RequestMeter("press-every-control");
    for (let i = 0; i < 5000; i++) meter.record(URL, "GET", 1_790_000_000_000);
    expect(await meter.pace()).toBe(0);
  });

  it("the metered fixture turns pacing on for every run, gates each test and lengthens its timeout by the hold", () => {
    const src = blankComments(read("e2e/prodTest.ts"));
    expect(src).toMatch(/meter\.paceTo\(ceilingFor\(label\), \{ workers: workerInfo\.config\.workers \}\);/);
    expect(src).toMatch(/await _requestMeter\.pace\(\);\s*await use\(\);/);
    expect(src).toMatch(/meter\.onPaceWait = \(ms\) => \{[\s\S]*?running = base\.info\(\);[\s\S]*?if \(running\.timeout > 0\) running\.setTimeout\(running\.timeout \+ ms\);/);
    const meter = blankComments(read("e2e/requestMeter.mjs"));
    expect(meter, "every page a metered context opens gets the gate").toMatch(/context\.on\("page", \(page\) => this\.pacePage\(page\)\);/);
  });
});
