/**
 * Q1205 — the direct-offer marker (jobs.direct_offer_status,
 * jobs.direct_offer_expires_at) is the server's once a job is posted.
 *
 * WHAT WAS BROKEN (read live 2026-10-04): authenticated holds table-level
 * UPDATE on jobs, "Customers can update their own jobs" has no WITH CHECK, and
 * no trigger named either column. A poster could re-arm 'pending' on a booked
 * job (a NULL expiry and the sweep never clears it), push a pending offer's
 * window out or clear it, or mark it 'accepted' by hand.
 *
 * THE CLASS, three layers:
 *   1. DB: the effective enforce_hire_columns_rpc_only (the Q346 "straight
 *      from a client" gate) refuses a change to either column.
 *   2. DB: every function whose effective definition writes either column in
 *      an UPDATE of jobs is SECURITY DEFINER (the gate lets exactly those
 *      through); the one invoker writer, jobs_reopen_retires_direct_offer, is
 *      a trigger whose name sorts after trg_hire_columns_rpc_only, so the gate
 *      never sees its write.
 *   3. Client: no `.from("jobs").update/upsert(...)` in src/ sends either key
 *      (the posting INSERT is the client's one legitimate writer).
 * Behaviour, red then green: src/test/pglite/directOfferMarkerRpcOnly.pglite.mjs
 * (applied 3x: ALL PASS; NEW_MIGRATION=skip: 8 FAILED).
 */
import { describe, it, expect } from "vitest";
import { join, relative } from "node:path";
import { readFileSync } from "node:fs";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const COLS = ["direct_offer_status", "direct_offer_expires_at"] as const;

describe("Q1205 layer 1: a client change of the direct-offer marker is refused", () => {
  const def = effectiveDefs(MIG_DIR).get("enforce_hire_columns_rpc_only");
  const body = blankSqlComments(def?.stmt ?? "").replace(/\s+/g, " ").toLowerCase();

  it("the gate is the newest definition and still gates on the request role", () => {
    expect(def?.file).toBeTruthy();
    expect(body).not.toMatch(/security\s+definer/);
    expect(body).toMatch(/if current_user::text not in \('authenticated', 'anon'\) then return new; end if;/);
  });

  it.each(COLS)("refuses any change of jobs.%s", (col) => {
    expect(body).toMatch(new RegExp(`if new\\.${col} is distinct from old\\.${col} then raise exception 'hire_requires_rpc`));
  });
});

describe("Q1205 layer 2: every writer of the marker is one the gate lets through", () => {
  const defs = effectiveDefs(MIG_DIR);
  const droppedAfter = new Map<string, string>();
  for (const f of migrationFiles(MIG_DIR)) {
    const sql = blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"));
    for (const m of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?/gi)) droppedAfter.set(m[1].toLowerCase(), f);
  }
  const JOBS_UPDATE = /update\s+(?:public\.)?jobs\b(?:\s+\w+)?\s+set\s+([^;]*?)(?:\bwhere\b|;|\breturning\b)/gi;
  const WRITES = /(?<![\w.])direct_offer_(?:status|expires_at)\s*=/i;
  const NEW_ASSIGN = /\bnew\.direct_offer_(?:status|expires_at)\s*:=/i;
  const updaters = new Map<string, string>();
  const triggerAssigners = new Map<string, string>();
  for (const [name, def] of defs) {
    const dropped = droppedAfter.get(name);
    if (dropped && dropped > def.file) continue;
    const code = blankSqlComments(def.stmt);
    if ([...code.matchAll(JOBS_UPDATE)].some((m) => WRITES.test(m[1]))) updaters.set(name, code);
    if (NEW_ASSIGN.test(code)) triggerAssigners.set(name, code);
  }

  it("the inventory is real", () => {
    expect(defs.size).toBeGreaterThan(100);
    expect(updaters.size).toBeGreaterThan(3);
    for (const n of ["respond_to_direct_offer", "expire_pending_direct_offers", "complete_direct_offer_accept"]) {
      expect(updaters.has(n), `${n} not recognised as a writer of the marker: the scan is blind`).toBe(true);
    }
  });

  it("each UPDATE writer is SECURITY DEFINER", () => {
    const invoker = [...updaters].filter(([, code]) => !/security\s+definer/i.test(code)).map(([n]) => n);
    expect(invoker, "an invoker function writing the marker would be refused by the gate (or be a new door)").toEqual([]);
  });

  it("each trigger that assigns NEW.direct_offer_* fires after trg_hire_columns_rpc_only", () => {
    expect([...triggerAssigners.keys()]).toContain("jobs_reopen_retires_direct_offer");
    // Last CREATE TRIGGER naming each assigning function on jobs.
    const names = new Map<string, string>();
    for (const f of migrationFiles(MIG_DIR)) {
      const sql = blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8"));
      for (const m of sql.matchAll(/create\s+trigger\s+(\w+)\s+before\s+[^;]*?\bon\s+(?:public\.)?jobs\b[^;]*?execute\s+(?:function|procedure)\s+(?:public\.)?(\w+)/gi)) {
        if (triggerAssigners.has(m[2].toLowerCase())) names.set(m[2].toLowerCase(), m[1].toLowerCase());
      }
    }
    for (const fn of triggerAssigners.keys()) {
      const tg = names.get(fn);
      if (!tg) continue; // not a jobs BEFORE trigger (e.g. an RPC assigning a record variable)
      expect(tg > "trg_hire_columns_rpc_only", `${tg} (${fn}) fires before the gate, so a client UPDATE it rewrites is refused`).toBe(true);
    }
  });
});

describe("Q1205 layer 3: the client never UPDATEs the marker", () => {
  const files = walkSource([join(ROOT, "src")]).filter((f) => !/\.test\.tsx?$|\/src\/test\//.test(f));
  let jobsUpdates = 0;
  const hits: string[] = [];
  for (const f of files) {
    const src = readSource(f);
    if (!src) continue;
    const code = blankComments(src);
    for (const m of code.matchAll(/\.from\(\s*["']jobs["']\s*\)/g)) {
      const chainEnd = code.indexOf(";", m.index!);
      const chain = code.slice(m.index!, chainEnd === -1 ? undefined : chainEnd);
      const verb = /\.(update|upsert)\s*\(/.exec(chain);
      if (!verb) continue;
      jobsUpdates++;
      if (/direct_offer_(?:status|expires_at)\s*:/.test(chain)) hits.push(`${relative(ROOT, f)}:${code.slice(0, m.index!).split("\n").length}`);
    }
  }

  it("the scan sees the client's jobs updates", () => {
    expect(files.length).toBeGreaterThan(800);
    expect(jobsUpdates).toBeGreaterThan(10);
  });

  it("no client jobs update sends direct_offer_status or direct_offer_expires_at", () => {
    expect(hits).toEqual([]);
  });
});

// Layer 1: each refusal broken.
// @mutate supabase/migrations/20261007032040_accept_offer_deadline_floor.sql | IF NEW.direct_offer_status IS DISTINCT FROM OLD.direct_offer_status THEN | IF false THEN
// @mutate supabase/migrations/20261007032040_accept_offer_deadline_floor.sql | IF NEW.direct_offer_expires_at IS DISTINCT FROM OLD.direct_offer_expires_at THEN | IF false THEN
// Layer 3: a client PATCH of the marker planted.
// @mutate src/components/job-card/activityActions/useLifecycleHandlers.ts | .update({ poster_confirmed_arrival_at: arrivedAt }) | .update({ poster_confirmed_arrival_at: arrivedAt, direct_offer_status: "pending" })
