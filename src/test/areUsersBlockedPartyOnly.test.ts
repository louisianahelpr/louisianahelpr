/**
 * Q348 — are_users_blocked answers only for one of the pair (or a server).
 *
 * WHAT WAS BROKEN (prod, 2026-09-24/26): the function is SECURITY DEFINER and
 * EXECUTE-granted to authenticated, so any signed-in user could RPC it for two
 * third parties and learn whether one had blocked the other. It cannot be
 * revoked from authenticated: three RLS policies call it as the invoking role.
 *
 * THE FIX (20260926034721): answer only when auth.uid() is one of the pair or
 * is_server_context(); otherwise NULL, the same for every pair.
 *
 * WHY THE CALLER INVENTORY IS PINNED: the fix is safe only because every live
 * caller passes the signed-in user as one of the pair (enumerated from
 * pg_proc/pg_policies, 2026-09-26; see the migration header). A NEW caller
 * that asks about two other people would silently get NULL, so it fails
 * "the caller inventory is exact" until someone checks it passes a party.
 *
 * Behavioural proof, red-before/green-after, 3x replay:
 * scripts/probes/are-users-blocked-party.pglite.mjs.
 */
//
// Registered mutations - each turns this guard RED on its own:
//   Dropping the party rule restores the third-party oracle.
// @mutate supabase/migrations/20260926034721_are_users_blocked_party_only.sql |     WHEN COALESCE(auth.uid() IN (_user_a, _user_b), false) |     WHEN true
//   Dropping the trigger arm lets a system message cross a block (review F1).
// @mutate supabase/migrations/20260926034721_are_users_blocked_party_only.sql |       OR pg_trigger_depth() > 0 | 
//   Re-granting anon.
// @mutate supabase/migrations/20260926034721_are_users_blocked_party_only.sql | FROM PUBLIC, anon; | FROM PUBLIC;
import { describe, it, expect } from "vitest";
import { join, relative } from "node:path";
import { readFileSync } from "node:fs";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const MIG_DIR = join(process.cwd(), "supabase/migrations");

// Functions whose effective definition calls are_users_blocked (pg_proc on
// prod matched exactly these, 2026-09-26). The RPC-style ones pass auth.uid()
// as one argument, or pin one to auth.uid() before the call; the two triggers
// (enforce_block_on_message_insert, enforce_application_job_state) get the real
// answer through the pg_trigger_depth() arm, because insert_job_status_system_message
// inserts messages between two people neither of whom is auth.uid().
const EXPECTED_CALLERS = [
  "accept_application",
  "accept_group_application",
  "can_send_message_to_in_job",
  "enforce_application_job_state",
  "enforce_block_on_message_insert",
  "get_my_saved_helpers",
  "respond_to_direct_offer",
];

describe("Q348: are_users_blocked refuses a third-party pair", () => {
  const defs = effectiveDefs(MIG_DIR);
  const def = defs.get("are_users_blocked");
  const body = blankSqlComments(def?.stmt ?? "");

  it("the inventory is real", () => {
    expect(defs.size).toBeGreaterThan(100);
    expect(def, "are_users_blocked has no definition in the migrations").toBeTruthy();
  });

  it("the newest definition answers only for a party or a server context, before it reads user_blocks", () => {
    const rule = body.search(
      /when\s+coalesce\(\s*auth\.uid\(\)\s+in\s*\(\s*_user_a\s*,\s*_user_b\s*\)\s*,\s*false\s*\)\s+or\s+public\.is_server_context\(\)\s+or\s+pg_trigger_depth\(\)\s*>\s*0\s+then/i,
    );
    const read = body.search(/from\s+public\.user_blocks/i);
    expect(rule, `newest definition (${def?.file}) has no party rule`).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(rule);
    // No ELSE branch that could answer: a non-party gets NULL.
    expect(body.slice(rule, body.search(/\bend\s*;/i))).not.toMatch(/\belse\b/i);
  });

  it("the newest migration touching its grants revokes PUBLIC and anon", () => {
    const grantFiles = migrationFiles(MIG_DIR).filter((f) =>
      /on\s+function\s+public\.are_users_blocked/i.test(blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"))),
    );
    const newest = blankSqlComments(readFileSync(join(MIG_DIR, grantFiles[grantFiles.length - 1]), "utf8"));
    expect(newest).toMatch(/revoke\s+all\s+on\s+function\s+public\.are_users_blocked\(uuid,\s*uuid\)\s+from\s+public,\s*anon/i);
  });

  it("every policy that calls it pins one argument to auth.uid() in the same statement", () => {
    // A policy asking about two OTHER users would get NULL, which a USING or
    // WITH CHECK reads as not-true: it would silently hide rows / refuse writes.
    let policies = 0;
    for (const f of migrationFiles(MIG_DIR)) {
      const sql = blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"));
      for (const m of sql.matchAll(/create\s+policy[\s\S]*?;/gi)) {
        if (!/are_users_blocked\s*\(/i.test(m[0])) continue;
        policies++;
        expect(m[0], `${f}: policy calls are_users_blocked without auth.uid()`).toMatch(/auth\.uid\(\)/i);
      }
    }
    expect(policies).toBeGreaterThan(2);
  });

  it("RPC callers outside SQL are exact (server-role edge functions and the dead client wrapper)", () => {
    const hits: string[] = [];
    for (const file of walkSource([join(process.cwd(), "src"), join(process.cwd(), "supabase/functions")])) {
      if (/\.test\.|\/test\//.test(file)) continue;
      if (/rpc\(\s*["'`]are_users_blocked["'`]/.test(readFileSync(file, "utf8"))) hits.push(relative(process.cwd(), file));
    }
    // charge-recurring-visits calls it with the service key (a server context,
    // real answer). userBlocks.ts has 0 callers (Q348 note); a signed-in call
    // about someone else gets NULL there, never the answer.
    expect(hits.sort()).toEqual(["src/lib/userBlocks.ts", "supabase/functions/charge-recurring-visits/index.ts"]);
  });

  it("the caller inventory is exact (a new caller must be checked to pass a party)", () => {
    const callers = [...defs.entries()]
      .filter(([name, d]) => name !== "are_users_blocked" && /are_users_blocked\s*\(/i.test(blankSqlComments(d.stmt)))
      .map(([name]) => name)
      .sort();
    expect(callers.length).toBeGreaterThan(5);
    expect(callers).toEqual(EXPECTED_CALLERS);
  });
});
