// Q1852 (lh-authz-rls finding 2026-10-16): declutter_seller_hidden(uuid) was the declutter_items read
// policy's helper, so every signed-in member could EXECUTE it and ask, for any person with a live
// listing, whether that seller is banned, has 3 Declutter strikes, is under 18 or is flagged
// business-like. 20261021142959 keeps that answer on the item row (declutter_items.seller_hidden =
// declutter_seller_out(seller_id)), kept current by triggers on every input declutter_seller_out reads
// plus a 10-minute sweep for endings that need no write, and revokes the helper from members.
//
// This guard reads the migrations as they are applied (newest definition wins, comments blanked):
//   1. the items read policy calls no hidden-state helper and tests the column;
//   2. declutter_seller_hidden's newest grant leaves authenticated without EXECUTE, and the
//      definer allowlist no longer excuses it (two-way with the revoke);
//   3. CLASS: every table and column the hidden-state functions read has a trigger that recomputes
//      the column, so a new input added to declutter_seller_out (a new table, a new profile column)
//      turns this red until it gets its trigger;
//   4. the sweep is scheduled.
// PGlite proof with prod's function bodies: src/test/pglite/declutterSellerHiddenColumn.pglite.mjs.
//
// @mutate supabase/migrations/20261021142959_declutter_seller_hidden_column.sql | REVOKE ALL ON FUNCTION public.declutter_seller_hidden(uuid) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.declutter_seller_hidden(uuid) FROM PUBLIC, anon;
// @mutate supabase/migrations/20261021142959_declutter_seller_hidden_column.sql |   AFTER UPDATE OF ban_status, auto_suspended_until, date_of_birth, user_id ON public.profiles | AFTER UPDATE OF ban_status, date_of_birth, user_id ON public.profiles
// @mutate supabase/migrations/20261021142959_declutter_seller_hidden_column.sql |   AFTER INSERT OR DELETE OR UPDATE OF user_id, business_like ON public.declutter_seller_flags |   AFTER INSERT OR UPDATE OF user_id, business_like ON public.declutter_seller_flags
// @mutate supabase/migrations/20261021142959_declutter_seller_hidden_column.sql |   AFTER INSERT OR DELETE OR UPDATE OF user_id, removed_at, expires_at, given_at ON public.declutter_strikes |   AFTER INSERT OR DELETE OR UPDATE OF user_id, given_at ON public.declutter_strikes
// @mutate supabase/migrations/20261021142959_declutter_seller_hidden_column.sql |         AND NOT seller_hidden\n |         AND NOT public.declutter_seller_hidden(seller_id)\n
// @mutate supabase/migrations/20261021142959_declutter_seller_hidden_column.sql |     PERFORM cron.schedule('declutter-seller-hidden', | PERFORM cron.unschedule('declutter-seller-hidden',
// @mutate supabase/migrations/20261021142959_declutter_seller_hidden_column.sql |   PERFORM pg_advisory_xact_lock(hashtextextended('declutter_seller_hidden:' \|\| p_seller::text, 0));\n | \n
// @mutate supabase/migrations/20261021142959_declutter_seller_hidden_column.sql |     PERFORM pg_advisory_xact_lock(hashtextextended('declutter_seller_hidden:' \|\| NEW.seller_id::text, 0));\n | \n
// @mutate supabase/migrations/20261021142959_declutter_seller_hidden_column.sql |   IF NEW.seller_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.seller_id IS DISTINCT FROM OLD.seller_id) THEN |   IF NEW.seller_id IS NOT NULL THEN
// @mutate supabase/migrations/20261021142959_declutter_seller_hidden_column.sql |                   WHERE c.buyer_id = v_uid AND c.seller_id = p_seller_id |                   WHERE c.seller_id = p_seller_id
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const SQL = FILES.map((f) => ({ f, sql: blankSqlComments(readFileSync(join(MIG_DIR, f), "utf8")) }));
const DEFS = effectiveDefs(MIG_DIR);
const POLICY = "declutter items: seller or switched-on members read live";
/** The functions whose answer the column caches: declutter_seller_out and every public function it calls, walked from the effective bodies. */
function hiddenStateFns(): string[] {
  const seen = new Set<string>();
  const walk = (fn: string) => {
    if (seen.has(fn) || !DEFS.has(fn)) return;
    seen.add(fn);
    const body = blankSqlComments(DEFS.get(fn)?.stmt ?? "");
    for (const m of body.matchAll(/\bpublic\.(\w+)\s*\(/g)) if (m[1] !== fn) walk(m[1]);
  };
  walk("declutter_seller_out");
  return [...seen];
}
const HIDDEN_STATE_FNS = hiddenStateFns();
const TRIGGER_FN = "declutter_seller_hidden_on_input";
const flat = (x: string) => x.replace(/\s+/g, " ");

function newestPolicy(): string {
  let found = "";
  for (const { sql } of SQL) {
    for (const m of sql.matchAll(/CREATE\s+POLICY\s+"([^"]+)"[\s\S]*?;/gi)) if (m[1] === POLICY) found = m[0];
  }
  return found;
}

/** Newest EXECUTE state of declutter_seller_hidden(uuid) for authenticated: the last GRANT/REVOKE naming it. */
function authenticatedCanExecuteHelper(): { can: boolean; statements: number } {
  let can = false;
  let statements = 0;
  for (const { sql } of SQL) {
    const re = /\b(GRANT|REVOKE)\s+(?:ALL|EXECUTE)\s+ON\s+FUNCTION\s+public\.declutter_seller_hidden\s*\(\s*uuid\s*\)\s+(TO|FROM)\s+([^;]+);/gi;
    for (const m of sql.matchAll(re)) {
      const roles = m[3].split(",").map((r) => r.trim().toLowerCase());
      statements++;
      if (roles.includes("authenticated")) can = m[1].toUpperCase() === "GRANT";
    }
  }
  return { can, statements };
}

/** Live triggers after every migration: name@table -> CREATE TRIGGER text (DROP TRIGGER removes). */
function liveTriggers(): Map<string, { table: string; text: string }> {
  const live = new Map<string, { table: string; text: string }>();
  for (const { sql } of SQL) {
    const re = /\bDROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?(\w+)\s+ON\s+(?:public\.)?(\w+)|\bCREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+(\w+)\s+([\s\S]*?)\bON\s+(?:public\.)?(\w+)([\s\S]*?);/gi;
    for (const m of sql.matchAll(re)) {
      if (m[1]) live.delete(`${m[1]}@${m[2]}`);
      else live.set(`${m[3]}@${m[5]}`, { table: m[5], text: `${m[4]} ON ${m[5]}${m[6]}` });
    }
  }
  return live;
}

/** Every (table, column) the hidden-state functions read, from their effective bodies: FROM public.<t> <alias> ... <alias>.<col>. */
function inputsRead(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const fn of HIDDEN_STATE_FNS) {
    const body = blankSqlComments(DEFS.get(fn)?.stmt ?? "");
    expect(body, `${fn} has a definition`).not.toBe("");
    // A read with no alias still names its table (it must have a trigger); its columns are read by alias only.
    for (const m of body.matchAll(/\bFROM\s+public\.(\w+)(?:\s+(?:AS\s+)?(?!WHERE\b|JOIN\b|LIMIT\b|ON\b)(\w+))?/gi)) {
      const [, table, alias] = m;
      const cols = out.get(table) ?? new Set<string>();
      if (alias) for (const c of body.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, "g"))) cols.add(c[1]);
      out.set(table, cols);
    }
  }
  return out;
}

describe("Declutter seller hidden state lives on the item row (Q1852)", () => {
  it("the items read policy tests the column and calls no hidden-state helper", () => {
    const p = newestPolicy();
    expect(p).toContain("NOT seller_hidden");
    for (const fn of ["declutter_seller_hidden", ...HIDDEN_STATE_FNS]) expect(p, fn).not.toContain(`${fn}(`);
  });

  it("members cannot execute declutter_seller_hidden, and the definer allowlist no longer excuses it", () => {
    const { can, statements } = authenticatedCanExecuteHelper();
    expect(statements).toBeGreaterThan(1);
    expect(can).toBe(false);
    const allow = readFileSync(join(process.cwd(), "scripts/ci/definer-exec-allowlist.json"), "utf8");
    expect(allow).not.toContain("declutter_seller_hidden(uuid)");
  });

  it("CLASS: every table and column the hidden-state functions read has a trigger that recomputes the column", () => {
    const inputs = inputsRead();
    // profiles, declutter_strikes, declutter_seller_flags (read 2026-10-21); a new input must get its trigger.
    expect(inputs.size).toBeGreaterThan(2);
    const triggers = [...liveTriggers().values()].filter((t) => t.text.includes(`${TRIGGER_FN}()`));
    for (const [table, cols] of inputs) {
      const mine = triggers.filter((t) => t.table === table);
      expect(mine.length, `${table}: no trigger runs ${TRIGGER_FN}`).toBeGreaterThan(0);
      const events = mine.map((t) => t.text).join(" ");
      expect(events, `${table}: no INSERT trigger`).toMatch(/\bINSERT\b/i);
      const updateOf = new Set(mine.flatMap((t) => (/UPDATE\s+OF\s+([\w\s,]+?)\s+ON\b/i.exec(t.text)?.[1] ?? "").split(",").map((c) => c.trim())));
      for (const c of cols) expect(updateOf.has(c), `${table}.${c} is read by the hidden-state functions but no trigger fires on UPDATE OF it`).toBe(true);
      // A deleted strike or flag can change the answer; a deleted profile only un-hides (the sweep heals it).
      if (table !== "profiles") expect(events, `${table}: no DELETE trigger`).toMatch(/\bDELETE\b/i);
    }
    const self = [...liveTriggers().values()].find((t) => t.table === "declutter_items" && t.text.includes("declutter_items_seller_hidden_set()"));
    expect(self?.text ?? "", "declutter_items recomputes its own column on the way in").toMatch(/BEFORE\s+INSERT\s+OR\s+UPDATE\s+OF\s+seller_id,\s*status,\s*seller_hidden/i);
  });

  it("the walk finds the hidden-state functions (inventory floor)", () => {
    // declutter_seller_out, declutter_member_out, member_under_18, declutter_active_strike_count (2026-10-21).
    expect(HIDDEN_STATE_FNS.length).toBeGreaterThan(3);
  });

  it("one writer per seller: both recompute paths take the per-seller lock before asking declutter_seller_out", () => {
    for (const fn of ["declutter_refresh_seller_hidden", "declutter_items_seller_hidden_set"]) {
      const body = blankSqlComments(DEFS.get(fn)?.stmt ?? "");
      const lock = body.search(/pg_advisory_xact_lock\(\s*hashtextextended\(\s*'declutter_seller_hidden:'/);
      const ask = body.search(/public\.declutter_seller_out\(/);
      expect(lock, `${fn} takes no per-seller lock`).toBeGreaterThan(-1);
      expect(lock < ask, `${fn} asks before it locks`).toBe(true);
    }
  });

  it("the item trigger locks only a row a refresh cannot see (INSERT or a new seller), never a status-only UPDATE", () => {
    // A status-only UPDATE already holds the row lock; an advisory lock after it would reverse the lock order of
    // every item-lock-then-status path and deadlock with a refresh (lh-authz-rls re-review 2026-10-21, V2).
    const body = flat(blankSqlComments(DEFS.get("declutter_items_seller_hidden_set")?.stmt ?? ""));
    expect(body).toMatch(/IF NEW\.seller_id IS NOT NULL AND \(TG_OP = 'INSERT' OR NEW\.seller_id IS DISTINCT FROM OLD\.seller_id\) THEN PERFORM pg_advisory_xact_lock\(/);
    expect(body.match(/pg_advisory_xact_lock\(/g)?.length).toBe(1);
  });

  it("declutter_delivery_quote asks the caller's own cart before it asks about the seller (no out / not-out oracle)", () => {
    const body = blankSqlComments(DEFS.get("declutter_delivery_quote")?.stmt ?? "");
    const cart = body.search(/FROM\s+public\.declutter_cart_items\s+c\s+WHERE\s+c\.buyer_id\s*=\s*v_uid/);
    const out = body.search(/public\.declutter_seller_out\(/);
    expect(cart, "the quote no longer checks the caller's own cart").toBeGreaterThan(-1);
    expect(out, "the quote no longer refuses an out seller").toBeGreaterThan(-1);
    expect(cart < out).toBe(true);
  });

  it("the sweep that heals time-based endings is scheduled", () => {
    const sweepSchedules = SQL.flatMap(({ sql }) => [...sql.matchAll(/cron\.schedule\(\s*'declutter-seller-hidden'[\s\S]*?declutter_seller_hidden_sweep\(\)/g)]);
    expect(sweepSchedules.length).toBeGreaterThan(0);
  });
});
