/**
 * THE SEEDER UPSERTS APPLICATIONS ON THE TABLE'S OWN UNIQUE KEY.
 *
 * `applications` is unique on (job_id, helper_id). Journeys apply the shared
 * helper to seed jobs through the app, which leaves a row with a RANDOM id. A
 * seeder that upserts on a deterministic seed id then collides on the pair
 * instead of merging, and PostgREST answers 409 — prod-audit run 37021988200
 * (2026-10-02) died in its seed step that way, so nothing after it was measured.
 *
 * This reads `scripts/audit/prod-seed.mjs` and asserts its applications upsert
 * conflicts on "job_id,helper_id" and that its rows carry no `id`, so an
 * existing journey row is merged rather than duplicated.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// @mutate scripts/audit/prod-seed.mjs | ], "job_id,helper_id"); | ]);

const src = readFileSync(resolve(__dirname, "../../scripts/audit/prod-seed.mjs"), "utf8");

function applicationsUpserts(): string[] {
  const calls: string[] = [];
  let at = src.indexOf('upsert("applications"');
  while (at !== -1) {
    // Walk to the call's closing paren, balancing brackets.
    let depth = 0;
    let end = at + "upsert".length;
    for (; end < src.length; end++) {
      const c = src[end];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    calls.push(src.slice(at, end + 1));
    at = src.indexOf('upsert("applications"', end);
  }
  return calls;
}

describe("prod-seed applications upsert", () => {
  const calls = applicationsUpserts();

  it("finds the seeder's applications upsert", () => {
    expect(calls.length).toBeGreaterThan(0);
  });

  it('conflicts on "job_id,helper_id", the table\'s unique key', () => {
    for (const call of calls) expect(call).toMatch(/,\s*"job_id,helper_id"\s*\)$/);
  });

  it("writes no seed id, so a journey's row for the same pair is merged", () => {
    for (const call of calls) expect(call).not.toMatch(/\bid:\s*sid\(/);
  });
});
