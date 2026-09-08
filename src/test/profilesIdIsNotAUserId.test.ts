import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `profiles.id` is NOT `auth.users.id`. Never join it to one.
 *
 * `public.profiles` has two uuid keys and they are different values:
 *   `id`      — the profile row's own primary key
 *   `user_id` — the account, i.e. what `auth.uid()` returns
 *
 * Every `*_id` column on other tables that names a PERSON — `jobs.customer_id`,
 * `jobs.helper_id`, `reviews.reviewer_id`, `disputes.opener_id` — holds the
 * ACCOUNT id, so it must be joined to `profiles.user_id`. Joining it to
 * `profiles.id` compiles, runs, returns zero rows, and reports no error.
 *
 * Measured on prod 2026-09-06: **0 of 44** profiles satisfy `id = user_id`.
 * Not "rarely equal" — never equal. So this mistake does not degrade a
 * feature, it deletes it, silently and completely.
 *
 * It shipped once and survived months. `get_neighbor_hire_count` (migration
 * 20260612260000_trust_graph.sql) joined `profiles p ON p.id = j.customer_id`
 * to power the "N neighbours hired them" badge. The badge never rendered for
 * any account, ever, and nobody noticed — an empty trust signal looks exactly
 * like a helper who simply has no neighbours vouching for them. It was found
 * only when someone read the SQL. Fixed in 20260907051731.
 *
 * This test is deliberately STATIC — no database, no network — so it runs on
 * every push in milliseconds. It cannot prove a join is semantically right;
 * it catches the one shape that is always wrong.
 */

const migrationsDir = resolve(__dirname, "../../supabase/migrations");

/**
 * Historical files that contain the bug as written at the time. They are the
 * record of what happened and must not be edited — a migration already applied
 * to prod is immutable. Each is superseded by a later migration that fixes it,
 * named here so this list cannot quietly become a place to hide new instances.
 */
const SUPERSEDED: Record<string, string> = {
  "20260612260000_trust_graph.sql":
    "get_neighbor_hire_count — fixed by 20260907051731_helper_proximity_returns_bands_not_coordinates.sql",
};

/** Person-naming foreign keys: these hold an ACCOUNT id, never a profile id. */
const ACCOUNT_ID_COLUMNS = [
  "customer_id",
  "helper_id",
  "user_id",
  "reviewer_id",
  "reviewee_id",
  "opener_id",
  "donor_id",
  "recipient_id",
  "tipper_id",
  "sender_id",
  "receiver_id",
  "applicant_id",
  "blocker_id",
  "blocked_id",
  "referrer_id",
  "referred_id",
];

/**
 * Strip SQL comments before matching. Without this the test fails on any
 * migration that *documents* the bug — including the one that fixed it, which
 * quotes the broken join in its header.
 */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/--[^\n]*/g, " "); // line comments
}

/**
 * Matches `profiles <alias> ON <alias>.id = <other>.<account column>` and the
 * reversed operand order. `\bprofiles` is word-anchored so `pet_profiles p ON
 * p.id = jp.pet_id` — a correct join, because `pet_profiles.id` really is the
 * pet id — does not match.
 */
function findBadJoins(sql: string): string[] {
  const cols = ACCOUNT_ID_COLUMNS.join("|");
  const patterns = [
    new RegExp(
      String.raw`(?:^|\s|\.)profiles\s+(?:AS\s+)?(\w+)[\s\S]{0,80}?\bON\s+\1\.id\s*=\s*\w+\.(?:${cols})\b`,
      "gi",
    ),
    new RegExp(
      String.raw`(?:^|\s|\.)profiles\s+(?:AS\s+)?(\w+)[\s\S]{0,80}?\bON\s+\w+\.(?:${cols})\s*=\s*\1\.id\b`,
      "gi",
    ),
  ];
  const hits: string[] = [];
  for (const re of patterns) {
    for (const m of sql.matchAll(re)) hits.push(m[0].replace(/\s+/g, " ").trim());
  }
  return hits;
}

describe("profiles.id is never joined to an account id", () => {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));

  it("finds migrations to scan", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("no migration joins public.profiles on .id = <account>_id", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file in SUPERSEDED) continue;
      const sql = stripSqlComments(readFileSync(resolve(migrationsDir, file), "utf8"));
      for (const hit of findBadJoins(sql)) offenders.push(`${file}: ${hit}`);
    }
    expect(offenders).toEqual([]);
  });

  it("still catches the shape — the known-bad file trips the matcher", () => {
    // Guards the guard. A registry that is both the input and the definition
    // of correctness cannot fail for a missing member, so assert the detector
    // actually fires on the one file we know contains the bug. If someone
    // "fixes" that historical migration in place, this fails and tells them
    // to remove the allowlist entry instead.
    const known = Object.keys(SUPERSEDED)[0];
    const sql = stripSqlComments(readFileSync(resolve(migrationsDir, known), "utf8"));
    expect(findBadJoins(sql).length).toBeGreaterThan(0);
  });

  it("does not flag pet_profiles, whose id really is the joined key", () => {
    expect(findBadJoins("JOIN public.pet_profiles p ON p.id = jp.pet_id")).toEqual([]);
  });

  it("does not flag the correct join", () => {
    expect(findBadJoins("JOIN profiles p ON p.user_id = j.customer_id")).toEqual([]);
  });

  it("flags both operand orders", () => {
    expect(findBadJoins("JOIN profiles p ON p.id = j.customer_id").length).toBe(1);
    expect(findBadJoins("JOIN profiles p ON j.customer_id = p.id").length).toBe(1);
  });
});
