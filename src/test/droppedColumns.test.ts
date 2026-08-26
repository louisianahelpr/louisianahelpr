// Guard against querying columns that no longer exist.
//
// `profiles.role` was DROPPED when poster/helper accounts were unified in
// 2026-05 (migrations 20260504142454, 20260505230500). It has broken things
// repeatedly and quietly ever since — the migration history alone carries four
// separate "still referenced the dropped column" repairs to database triggers.
//
// It broke application code too, and that is what this test exists for.
// PostgREST returns 400 for the WHOLE select when one column is unknown, so a
// single stale name takes out the entire query:
//
//   - `stripe-idv-start` selected it, so the 400 tripped its profile-read
//     guard and the function 500'd on every attempt. Identity verification was
//     completely dead, and all the user ever saw was "Edge Function returned a
//     non-2xx status code".
//   - `cleanup-abandoned-accounts` selected it AND discarded the error, so
//     `profile` was null for every user and the cron skipped all of them — a
//     silent no-op with no log line.
//
// This is a source-text check, which is blunt, but the failure mode it catches
// is invisible at compile time (PostgREST column names are strings) and only
// shows up in production.

import { describe, it, expect } from "vitest";
import { walkSource, readSource } from "./helpers/walkSource";

const ROOTS = ["src", "supabase/functions"];

/**
 * Matches a `.from("profiles")` whose following `.select("…")` names `role` as
 * a bare column. Deliberately narrow: `user_roles.role` is the LIVE column that
 * replaced it, and embedded selects like `businesses!inner(...)` on other
 * tables must keep working.
 */
const PROFILES_SELECT = /\.from\(\s*["']profiles["']\s*\)[\s\S]{0,200}?\.select\(\s*["']([^"']*)["']/g;

describe("dropped-column guard", () => {
  // Walks every .ts/.tsx under src/ and supabase/functions — ~700ms alone, but
  // it competes with 180+ other suites for the same disk, so it keeps the
  // generous timeout. The OTHER half of its 2026-08-25 flakiness was not
  // slowness at all: it read the edge harness's transient *.gen.ts modules and
  // died on ENOENT when they were cleaned up mid-walk. walkSource skips
  // generated modules and readSource tolerates a file that vanishes.
  it("no source file selects `role` from `profiles` — the column was dropped in 2026-05", () => {
    const offenders: string[] = [];
    for (const file of walkSource(ROOTS)) {
      if (file.endsWith("droppedColumns.test.ts")) continue;
      const src = readSource(file);
      if (src === null) continue; // deleted mid-walk; cannot be an offender
      for (const m of src.matchAll(PROFILES_SELECT)) {
        const columns = m[1].split(",").map((c) => c.trim().split(":")[0].trim());
        if (columns.includes("role")) offenders.push(`${file} → select("${m[1]}")`);
      }
    }
    expect(
      offenders,
      `profiles.role no longer exists; PostgREST 400s the whole select. Use user_roles for admin checks.\n${offenders.join("\n")}`,
    ).toEqual([]);
  }, 30_000);
});
