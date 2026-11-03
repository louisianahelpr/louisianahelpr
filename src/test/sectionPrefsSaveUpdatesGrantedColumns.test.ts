// App Store gate (release gate write-contract, main 3ebffa3aea, run 41553101510): saveSectionPrefsRow used
// `.upsert({user_id, ...}, {onConflict: "user_id"})`. PostgREST makes that ON CONFLICT DO UPDATE SET for every
// payload column, user_id included, and 20261102074244 (Q2199) grants authenticated UPDATE only on
// (section_order, sections_hidden, updated_at). So once a member had a row, every later Customize save failed 42501.
// The fake table below enforces that column grant, a unique user_id and the upsert's real SQL shape, so the old
// upsert goes red on the second save and the fix (update the granted columns; insert when no row; on a 23505
// race, update once more) stays green.
//
// @mutate src/lib/sectionPrefsRow.ts | .update({ section_order: order, | .update({ user_id: userId, section_order: order,
// @mutate src/lib/sectionPrefsRow.ts | if (inserted.error?.code === "23505") { | if (false) {
// @mutate src/lib/sectionPrefsRow.ts | if ((first.count ?? 0) > 0) return { error: null }; | if (first.count === -1) return { error: null };
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
const UPDATE_GRANT = new Set(["section_order", "sections_hidden", "updated_at"]);

const db = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  calls: [] as Array<{ op: string; keys: string[] }>,
  /** Rows another tab/device inserts between our update and our insert (the race). */
  sneakIn: null as null | Record<string, unknown>,
  failNext: null as null | { message: string; code?: string },
}));

function denied(keys: string[]) {
  const bad = keys.find((k) => !UPDATE_GRANT.has(k));
  return bad ? { message: `permission denied for table member_section_prefs (column ${bad})`, code: "42501" } : null;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "member_section_prefs") throw new Error(`unexpected table ${table}`);
      return {
        update: (vals: Row, opts?: { count?: string }) => ({
          eq: async (col: string, uid: string) => {
            db.calls.push({ op: "update", keys: Object.keys(vals) });
            if (col !== "user_id") throw new Error(`update filtered on ${col}`);
            if (db.failNext) { const e = db.failNext; db.failNext = null; return { error: e, count: null }; }
            const no = denied(Object.keys(vals));
            if (no) return { error: no, count: null };
            const row = db.rows.get(uid);
            if (row) Object.assign(row, vals);
            if (!row && db.sneakIn) { db.rows.set(uid, db.sneakIn); db.sneakIn = null; }
            return { error: null, count: opts?.count === "exact" ? (row ? 1 : 0) : null };
          },
        }),
        insert: async (vals: Row) => {
          db.calls.push({ op: "insert", keys: Object.keys(vals) });
          const uid = String(vals.user_id);
          if (db.rows.has(uid)) return { error: { message: "duplicate key value violates unique constraint", code: "23505" } };
          db.rows.set(uid, { ...vals });
          return { error: null };
        },
        // PostgREST: INSERT ... ON CONFLICT (user_id) DO UPDATE SET <every payload column>.
        upsert: async (vals: Row) => {
          db.calls.push({ op: "upsert", keys: Object.keys(vals) });
          const uid = String(vals.user_id);
          const row = db.rows.get(uid);
          if (!row) { db.rows.set(uid, { ...vals }); return { error: null }; }
          const no = denied(Object.keys(vals));
          if (no) return { error: no };
          Object.assign(row, vals);
          return { error: null };
        },
      };
    },
  },
}));

import { saveSectionPrefsRow } from "@/lib/sectionPrefsRow";

beforeEach(() => {
  db.rows.clear();
  db.calls.length = 0;
  db.sneakIn = null;
  db.failNext = null;
});

describe("Customize saves update only the granted columns", () => {
  it("first save creates the row; every later save succeeds and changes it", async () => {
    expect(await saveSectionPrefsRow("u1", ["jobs", "declutter"], [])).toEqual({ error: null });
    expect(db.rows.get("u1")).toMatchObject({ user_id: "u1", section_order: ["jobs", "declutter"], sections_hidden: [] });
    db.calls.length = 0;
    expect(await saveSectionPrefsRow("u1", ["declutter", "jobs"], ["shops"])).toEqual({ error: null });
    expect(db.calls.map((c) => c.op)).toEqual(["update"]); // a row exists: one update, no insert attempt
    expect(await saveSectionPrefsRow("u1", ["declutter", "jobs"], ["homes"])).toEqual({ error: null });
    expect(db.rows.get("u1")).toMatchObject({ user_id: "u1", section_order: ["declutter", "jobs"], sections_hidden: ["homes"] });
  });

  it("no write ever asks to UPDATE a column the grant leaves out (user_id)", async () => {
    await saveSectionPrefsRow("u2", ["jobs"], []);
    await saveSectionPrefsRow("u2", ["jobs"], ["shops"]);
    const updates = db.calls.filter((c) => c.op === "update" || c.op === "upsert");
    expect(updates.length).toBeGreaterThan(1);
    for (const c of updates) expect(c.keys.filter((k) => !UPDATE_GRANT.has(k))).toEqual([]);
  });

  it("an insert that loses the race to another device (23505) updates once more and succeeds", async () => {
    db.sneakIn = { user_id: "u3", section_order: ["homes"], sections_hidden: [] };
    expect(await saveSectionPrefsRow("u3", ["jobs", "homes"], ["shops"])).toEqual({ error: null });
    expect(db.calls.map((c) => c.op)).toEqual(["update", "insert", "update"]);
    expect(db.rows.get("u3")).toMatchObject({ section_order: ["jobs", "homes"], sections_hidden: ["shops"] });
  });

  it("an update error is handed back to the caller, with no insert attempted", async () => {
    db.failNext = { message: "offline" };
    expect(await saveSectionPrefsRow("u4", ["jobs"], [])).toEqual({ error: { message: "offline" } });
    expect(db.calls.map((c) => c.op)).toEqual(["update"]);
  });
});
