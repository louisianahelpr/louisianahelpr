/**
 * AM-002 (c): edge functions inserted admin/user notifications with a bare
 * `await supabase.from("notifications").insert({...})`, result discarded, so a
 * failed insert (RLS, constraint, a renamed column) silently meant the admin
 * was never told about a chargeback. Class: every edge-function source file.
 * The chargeback handlers now check the error; the remaining bare sites are an
 * EXACT ratchet (lower BASELINE in the commit that fixes one; a stale-high
 * baseline fails too). Remaining work: docs/OPEN.md Q-line "bare notification
 * inserts".
 *
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeCreated.ts | const { error: noticeErr } = await supabase.from("notifications").insert({ | await supabase.from("notifications").insert({
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// @two-way src/test/edgeNotificationInsertsChecked.test.ts:expect(bare.length).toBe(BASELINE);
const BASELINE = 33;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

const files = walk("supabase/functions");
const BARE = /^\s*await supabase\w*\.from\("notifications"\)\.insert\(/;
const bare = files.flatMap((f) =>
  readFileSync(f, "utf8")
    .split("\n")
    .map((l, i) => (BARE.test(l) ? `${f}:${i + 1}` : null))
    .filter((x): x is string => x !== null),
);

describe("edge-function notification inserts check their error (AM-002)", () => {
  it("the inventory is real", () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it("the chargeback handlers have no bare insert", () => {
    expect(bare.filter((s) => /chargeDispute(Created|Closed)\.ts/.test(s))).toEqual([]);
  });

  it("bare inserts elsewhere match the exact baseline", () => {
    expect(bare.length).toBe(BASELINE);
  });
});
