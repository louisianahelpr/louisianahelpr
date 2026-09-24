/**
 * ST-007: str-ical-sync created the cleaning job BEFORE writing its dedup row,
 * so the cron and the host's "Sync now" running together made two jobs for
 * one checkout. The claim (insert into str_processed_events, which carries
 * UNIQUE (connection_id, event_uid)) must come first, a lost race (23505)
 * must skip the event, and a failed job insert must release the claim.
 *
 * @mutate supabase/functions/str-ical-sync/index.ts | if (claimError.code !== '23505') { | if (claimError.code === 'never') {
 * @mutate supabase/functions/str-ical-sync/index.ts |               .delete()\n              .eq('id', claim.id); |               .select('id')\n              .eq('id', claim.id);
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("supabase/functions/str-ical-sync/index.ts", "utf8");

describe("STR sync claims the event before creating the job (ST-007)", () => {
  const claimAt = src.search(/from\('str_processed_events'\)\s*\.insert\(/);
  const jobAt = src.search(/from\('jobs'\)\s*\.insert\(/);

  it("both writes are present", () => {
    expect(claimAt).toBeGreaterThan(0);
    expect(jobAt).toBeGreaterThan(0);
  });

  it("the claim insert precedes the job insert", () => {
    expect(claimAt).toBeLessThan(jobAt);
  });

  it("a lost race skips; a failed job releases the claim", () => {
    const afterClaim = src.slice(claimAt, jobAt);
    expect(afterClaim).toMatch(/claimError\.code !== '23505'/);
    expect(afterClaim).toMatch(/continue;/);
    const jobErr = src.slice(jobAt, src.indexOf("jobsCreated++"));
    expect(jobErr).toMatch(/from\('str_processed_events'\)\s*\.delete\(\)\s*\.eq\('id', claim\.id\)/);
  });
});
