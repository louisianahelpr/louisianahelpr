/**
 * OPEN LOW "can_review_job requires payment_status='released' but INSERT
 * policy also allows payout_pending" (2026-10-02).
 *
 * The reviews INSERT policy "Users can create reviews for eligible jobs"
 * accepts a set of jobs.payment_status values. Both places that offer the
 * "Leave a review" button must offer it for exactly that set: hiding it on a
 * status the policy accepts strands a review the server would take, and
 * showing it on one the policy refuses is a button that always fails.
 *
 * The policy set is read from the NEWEST migration that creates the policy, so
 * a future migration that widens or narrows it fails this test until the UI
 * gates follow.
 *
 * @mutate src/pages/posts/postedJobCard/steps/CompletedStep.tsx | job.payment_status === "payout_pending") && | job.payment_status === "mutated") &&
 * @mutate src/pages/jobs/AppliedJobCard.tsx | job.payment_status === "payout_pending") && !!posterId | job.payment_status === "mutated") && !!posterId
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = join(__dirname, "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const POLICY = "Users can create reviews for eligible jobs";

function policyStatuses(): { file: string; statuses: string[] } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files.reverse()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    const at = sql.lastIndexOf(`CREATE POLICY "${POLICY}"`);
    if (at < 0) continue;
    const body = sql.slice(at, sql.indexOf(";", at));
    const m = body.match(/j\.payment_status\s+IN\s*\(([^)]*)\)/i);
    if (!m) throw new Error(`${f}: policy found but no payment_status IN (...) list`);
    const statuses = [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort();
    return { file: f, statuses };
  }
  throw new Error(`no migration creates policy "${POLICY}"`);
}

function gateStatuses(rel: string): string[] {
  const src = readFileSync(join(ROOT, rel), "utf8");
  const lines = src
    .split("\n")
    .filter((l) => /job\.payment_status === "released"/.test(l) && !l.trim().startsWith("//"));
  expect(lines, `${rel}: exactly one review gate line`).toHaveLength(1);
  return [...lines[0].matchAll(/job\.payment_status === "(\w+)"/g)].map((x) => x[1]).sort();
}

describe("review button gates match the reviews INSERT policy", () => {
  const policy = policyStatuses();

  it("reads a non-empty status set from the newest policy migration", () => {
    expect(policy.statuses.length).toBeGreaterThan(0);
  });

  for (const rel of [
    "src/pages/posts/postedJobCard/steps/CompletedStep.tsx",
    "src/pages/jobs/AppliedJobCard.tsx",
  ]) {
    it(`${rel} offers a review for exactly the policy's payment statuses (${policy.file})`, () => {
      expect(gateStatuses(rel)).toEqual(policy.statuses);
    });
  }
});
