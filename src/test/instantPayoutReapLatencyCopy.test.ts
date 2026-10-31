/**
 * ME-017 #5: instant-payout's stranded-row alerts promised the reaper frees
 * the lock "within the hour". The reaper runs hourly (cron '34 * * * *') and
 * only takes rows older than its age gate (30 minutes), so the worst case is
 * 60 + 30 = 90 minutes. The copy's number is checked against the schedule and
 * gate read from the migrations, so a later change to either re-checks it.
 *
 * @mutate supabase/functions/instant-payout/index.ts | will release the lock within about 90 minutes | will release the lock within the hour
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const migrations = readdirSync(resolve(root, "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(resolve(root, "supabase/migrations", f), "utf8"));

function lastMatch(re: RegExp): RegExpMatchArray | null {
  let found: RegExpMatchArray | null = null;
  for (const sql of migrations) for (const m of sql.matchAll(re)) found = m;
  return found;
}

describe("instant-payout reaper latency copy (ME-017 #5)", () => {
  it("every 'within N minutes' promise covers hourly cadence + the reaper's age gate", () => {
    const schedule = lastMatch(/'reap-stranded-instant-payouts',\s*'([^']+)'/g);
    expect(schedule, "reaper cron schedule not found in migrations").not.toBeNull();
    expect(schedule![1]).toMatch(/^\d+ \* \* \* \*$/); // hourly
    const fnDef = lastMatch(/FUNCTION public\.reap_stranded_instant_payouts\(\)[\s\S]*?\$\$;?/g);
    expect(fnDef).not.toBeNull();
    const gate = /interval '(\d+) minutes'/.exec(fnDef![0]);
    expect(gate, "age gate not found").not.toBeNull();
    const worst = 60 + Number(gate![1]);

    const src = readFileSync(resolve(root, "supabase/functions/instant-payout/index.ts"), "utf8");
    const reaperLines = src.split("\n").filter((l) => /reap_stranded_instant_payouts\)/.test(l));
    expect(reaperLines.length).toBeGreaterThan(0);
    for (const line of reaperLines) {
      expect(line).not.toMatch(/within the hour/);
      const n = /within about (\d+) minutes/.exec(line);
      expect(n, line.slice(0, 120)).not.toBeNull();
      expect(Number(n![1])).toBeGreaterThanOrEqual(worst);
    }
  });
});

// JOBS3-55: "In your debit card in ~30 minutes" was awkward, and the note below it said the time again.
// @mutate src/components/InstantPayoutDialog.tsx | Prefer to wait? Standard payouts are{" "} | Arrives in ~30 minutes. Prefer to wait? Standard payouts are{" "}
describe("the instant payout dialog says the time once, in plain words", () => {
  const dialog = readFileSync(resolve(root, "src/components/InstantPayoutDialog.tsx"), "utf8");
  it("reads properly and does not repeat itself", () => {
    expect(dialog).toContain("Goes to your debit card in about 30 minutes.");
    expect(dialog).not.toContain("In your debit card");
    expect(dialog).not.toContain("Arrives in ~30 minutes");
  });
});
