/**
 * Q301: block_user_and_settle is one transaction. Its settle step cancels a
 * shared live job through a jobs UPDATE that enforce_ban_gate refuses, so for
 * a banned caller that refusal rolled back the block inserted earlier in the
 * same call. The newest definition must return after the block, before any
 * jobs UPDATE, when is_caller_banned(). Behaviour is proven in
 * src/test/pglite/bannedBlockerKeepsBlock.pglite.mjs (red without the fix).
 *
 * @mutate supabase/migrations/20260923232809_banned_blocker_keeps_block.sql |   IF public.is_caller_banned() THEN |   IF false THEN
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(resolve(__dirname, "../.."), "supabase", "migrations");
const defs = readdirSync(MIG)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ f, sql: blankSqlComments(readFileSync(join(MIG, f), "utf8")) }))
  .filter(({ sql }) => /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.block_user_and_settle\s*\(/i.test(sql));

describe("a banned blocker keeps the block (Q301)", () => {
  it("finds the newest block_user_and_settle", () => {
    expect(defs.length).toBeGreaterThan(1);
  });

  it("returns on is_caller_banned() after the user_blocks INSERT and before any jobs UPDATE", () => {
    const { sql } = defs[defs.length - 1];
    const body = sql.slice(sql.search(/FUNCTION\s+public\.block_user_and_settle/i));
    const insert = body.search(/INSERT\s+INTO\s+public\.user_blocks/i);
    const gate = body.search(/IF\s+public\.is_caller_banned\(\)\s+THEN\s+RETURN\b/i);
    const update = body.search(/UPDATE\s+public\.jobs/i);
    expect(insert).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(insert);
    expect(gate).toBeLessThan(update);
  });
});
