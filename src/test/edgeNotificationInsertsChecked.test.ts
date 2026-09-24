/**
 * AM-002 (c): edge functions inserted admin/user notifications with a bare
 * `await supabase.from("notifications").insert({...})`, result discarded, so a
 * failed insert (RLS, constraint, a renamed column) silently meant the admin
 * was never told about a chargeback. Class: every edge-function source file.
 * The chargeback handlers check the error inline; the other 33 sites (Q358,
 * 2026-09-24) go through _shared/insertNotifications.ts, which logs a refusal.
 * No bare insert may come back.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeCreated.ts | const { error: noticeErr } = await supabase.from("notifications").insert({ | await supabase.from("notifications").insert({
 * @mutate supabase/functions/_shared/insertNotifications.ts |     if (error) { |     if (false) {
 * @mutate supabase/functions/auto-expire-jobs/index.ts | await insertNotifications(supabase, { | await supabase.from("notifications").insert({
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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

  it("no edge function inserts a notification without checking the error", () => {
    expect(bare).toEqual([]);
  });

  it("the shared helper checks and logs the error", () => {
    const helper = readFileSync("supabase/functions/_shared/insertNotifications.ts", "utf8");
    expect(helper).toMatch(/const \{ error \} = await client\.from\("notifications"\)\.insert\(rows\);\s*if \(error\) \{\s*const list/);
    expect(helper).toContain('console.error("[notifications] insert failed"');
  });
});
