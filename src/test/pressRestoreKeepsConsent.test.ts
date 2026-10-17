/*
 * CLASS GUARD: the press cleanup never writes a Terms-acceptance column back
 * from its run-start snapshot (Q?press-restores-consent, 2026-10-17).
 *
 * press-every-control snapshots each shared account's profile when a leg
 * starts and writes every changed column back when it ends. Press run
 * 39014836855 leg 2 (snapshot 08:43:46Z) logged "customer profile: restored
 * terms_accepted_at" and "admin profile: restored terms_accepted_at" at
 * 09:29:19Z: poster-e2e's acceptance, re-recorded at 09:14:09Z, went back to
 * 2026-10-14 19:28:18Z (measured on prod: profiles.terms_accepted_at, and edge
 * logs PATCH 09:29:14Z). A snapshot taken during the 09:13:20-09:14:09Z
 * downgrade would have written "Sep 2026" back as well.
 *
 * Inventory from source: every profiles column whose name says terms (read
 * from the generated src/integrations/supabase/types.ts Row) must be in
 * PROFILE_SKIP, and profileRestorePatch must leave them out while still
 * restoring an ordinary column.
 */

// @mutate scripts/audit/pressProdSafety.mjs |   "terms_version_accepted", "terms_accepted_at", "accepted_terms_at", |   "terms_version_accepted", "accepted_terms_at",
// @mutate scripts/audit/pressProdSafety.mjs | const patch = profileRestorePatch(before, after); | const patch = Object.fromEntries(Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]) && k !== "updated_at").map((k) => [k, before[k]]));

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error - plain .mjs tool script, no types (as in pressProdSafety.test.ts)
import * as safety from "../../scripts/audit/pressProdSafety.mjs";

const PROFILE_SKIP = safety.PROFILE_SKIP as Set<string>;
const profileRestorePatch = safety.profileRestorePatch as (before: Record<string, unknown>, after: Record<string, unknown>) => Record<string, unknown>;

const root = join(__dirname, "..", "..");

function profileRowColumns(): string[] {
  const types = readFileSync(join(root, "src/integrations/supabase/types.ts"), "utf8");
  const start = types.indexOf("      profiles: {\n        Row: {");
  expect(start, "profiles Row not found in types.ts").toBeGreaterThan(-1);
  const body = types.slice(start, types.indexOf("        }", start + 30));
  return [...body.matchAll(/^\s{10}(\w+)\??:/gm)].map((m) => m[1]);
}

describe("the press cleanup keeps the Terms acceptance it finds", () => {
  const consent = profileRowColumns().filter((c) => /terms/.test(c));

  it("inventory: every terms column of profiles is skipped (floor)", () => {
    expect(consent.length).toBeGreaterThanOrEqual(3);
    expect(consent.filter((c) => !PROFILE_SKIP.has(c))).toEqual([]);
  });

  it("profileRestorePatch writes back an ordinary column but no consent column", () => {
    const before = { bio: "old", terms_version_accepted: "Oct 2026", terms_accepted_at: "2026-10-14T19:28:18.598Z", accepted_terms_at: "2026-10-01T00:00:00Z", updated_at: "a" };
    const after = { bio: "new", terms_version_accepted: "Oct 2026", terms_accepted_at: "2026-10-17T09:14:08.000Z", accepted_terms_at: "2026-10-01T00:00:00Z", updated_at: "b" };
    expect(profileRestorePatch(before, after)).toEqual({ bio: "old" });
    // A snapshot taken inside a downgrade window: nothing to write back.
    const snapshotInWindow = { ...after, terms_version_accepted: "Sep 2026" };
    expect(profileRestorePatch(snapshotInWindow, after)).toEqual({});
  });

  it("cleanup builds its PATCH through profileRestorePatch", () => {
    const src = blankComments(readFileSync(join(root, "scripts/audit/pressProdSafety.mjs"), "utf8"));
    const cleanup = src.match(/export async function cleanup\([\s\S]*?\n}\n/)?.[0] ?? "";
    expect(cleanup, "cleanup is gone").not.toBe("");
    expect(cleanup).toMatch(/const patch = profileRestorePatch\(before, after\);/);
  });
});
