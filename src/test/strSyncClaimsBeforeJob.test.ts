/**
 * ST-007: str-ical-sync created the cleaning job BEFORE writing its dedup row,
 * so the cron and the host's "Sync now" running together made two jobs for
 * one checkout. The claim (insert into str_processed_events, which carries
 * UNIQUE (connection_id, event_uid)) must come first, a lost race (23505)
 * must skip the event, and a failed write after it must release the claim.
 *
 * Q768 (2026-10-07): the sync no longer creates a job at all; the write after
 * the claim is the host's notice (noJobRowBeforePayment.test.ts). The same
 * order holds: claim, then notify, and a failed notice releases the claim so
 * the next run tells them.
 *
 * @mutate supabase/functions/str-ical-sync/index.ts | if (claimError.code !== '23505') { | if (claimError.code === 'never') {
 * @mutate supabase/functions/str-ical-sync/index.ts |               .delete()\n              .eq('id', claim.id); |               .select('id')\n              .eq('id', claim.id);
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("supabase/functions/str-ical-sync/index.ts", "utf8");

describe("STR sync claims the event before telling the host (ST-007, Q768)", () => {
  const claimAt = src.search(/from\('str_processed_events'\)\s*\.insert\(/);
  const notifyAt = src.search(/from\('notifications'\)\.insert\(/);

  it("both writes are present", () => {
    expect(claimAt).toBeGreaterThan(0);
    expect(notifyAt).toBeGreaterThan(0);
  });

  it("the claim insert precedes the notice", () => {
    expect(claimAt).toBeLessThan(notifyAt);
  });

  it("a lost race skips; a failed notice releases the claim", () => {
    const afterClaim = src.slice(claimAt, notifyAt);
    expect(afterClaim).toMatch(/claimError\.code !== '23505'/);
    expect(afterClaim).toMatch(/continue;/);
    const notifyErr = src.slice(notifyAt, src.indexOf("turnoversImported++"));
    expect(notifyErr).toMatch(/from\('str_processed_events'\)\s*\.delete\(\)\s*\.eq\('id', claim\.id\)/);
  });
});
