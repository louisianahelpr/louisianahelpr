import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

/**
 * THE CLASS (docs/OPEN.md Q1204, owner decision 2026-10-03): once a Helpr is
 * booked, the job's place and details are LOCKED against the poster, the way
 * Q423 locks date_needed and start_time. Before 20261004165404 the poster
 * could PATCH location, parish, zip_code, title, description, category,
 * special_requirements, photos, scope_video_url, estimated_hours and
 * is_flexible_schedule on a booked job and the Helpr was never told.
 *
 * Pinned on the definitions the database holds (effectiveDefs):
 *   - every column the poster's edit dialog writes is in locked_always or
 *     locked_when_booked, or on EDIT_EXEMPT with a reason (two-way);
 *   - the place columns the dialog does not write (parish, zip_code, the map
 *     pin) and the scope media are locked too;
 *   - the schedule-change flag carve-out covers the two schedule columns only;
 *   - photo proof may be relaxed but not raised once booked;
 *   - Q1189: created_at is locked on UPDATE and reset on a poster's INSERT.
 * Behaviour (PATCH refused when booked, allowed when open, server write
 * passes, 3x replay, red on main): src/test/pglite/bookedJobLocked.pglite.mjs.
 *
 * @mutate supabase/migrations/20261004193548_booked_job_terms_locked.sql |     'scope_video_url',\n |     -- removed\n
 * @mutate supabase/migrations/20261004193548_booked_job_terms_locked.sql |     'estimated_hours',\n |     -- removed\n
 * @mutate supabase/migrations/20261004193548_booked_job_terms_locked.sql |     'latitude',\n |     -- removed\n
 * @mutate supabase/migrations/20261004193548_booked_job_terms_locked.sql |     'location',\n |     'location_x',\n
 * @mutate supabase/migrations/20261005060416_direct_offer_markers_server_owned_on_insert.sql |   NEW.created_at                  := now();\n |     -- removed\n
 * @mutate supabase/migrations/20261004193548_booked_job_terms_locked.sql |     'created_at'\n |     -- removed\n
 * @mutate supabase/migrations/20261004193548_booked_job_terms_locked.sql |        AND NEW.require_photo_proof IS TRUE THEN | AND false THEN
 * @mutate supabase/migrations/20261004193548_booked_job_terms_locked.sql |        IF changed_col IN ('date_needed', 'start_time')\n           AND current_setting | IF current_setting
 * @mutate src/pages/posts/EditJobDialog.tsx | special_requirements: specialReq.trim() \|\| null, | special_requirements: specialReq.trim() \|\| null, is_urgent_x: false,
 */

const REPO = resolve(__dirname, "..", "..");
const DEFS = effectiveDefs(join(REPO, "supabase", "migrations"));
const body = (fn: string): string => {
  const d = DEFS.get(fn);
  if (!d) throw new Error(`${fn}: no definition in the migrations`);
  return blankSqlComments(d.stmt);
};

function arrays(fn: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of body(fn).matchAll(/(\w+)\s+CONSTANT\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/gi)) {
    out[m[1]] = [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]);
  }
  return out;
}

/** The keys of the edit dialog's updateData literal (the PATCH it sends for an open job). */
function editDialogColumns(): string[] {
  const src = blankComments(readFileSync(join(REPO, "src/pages/posts/EditJobDialog.tsx"), "utf8"));
  const start = src.indexOf('const updateData: TablesUpdate<"jobs"> = {');
  expect(start, "updateData literal not found in EditJobDialog").toBeGreaterThan(-1);
  const lit = src.slice(start, src.indexOf("\n    };", start));
  return [...new Set([...lit.matchAll(/(?:^\s+|\{ ?|, )([a-z][a-z0-9_]*):\s/gm)].map((m) => m[1]).filter((k) => k !== "updateData"))];
}

/** Written by the edit dialog but deliberately not in the booked lock, each with why (two-way). */
// @two-way src/test/bookedJobPlaceLocked.test.ts:expect(Object.keys(EDIT_EXEMPT)
const EDIT_EXEMPT: Record<string, string> = {
  require_photo_proof: "relaxing the gate stays open to the poster; raising it is refused by its own branch (asserted below)",
  expires_at: "only recomputed from the schedule columns, which are locked (trg_job_expiry_floor); not a detail the Helpr agreed to",
};

describe("a booked job's place and details are locked against the poster (Q1204)", () => {
  const lock = arrays("enforce_poster_jobs_money_lock");
  const booked = new Set(lock.locked_when_booked ?? []);
  const always = new Set(lock.locked_always ?? []);
  const lockBody = body("enforce_poster_jobs_money_lock");

  it("derives a real inventory", () => {
    const cols = editDialogColumns();
    expect(cols.length).toBeGreaterThan(8);
    expect(cols).toEqual(expect.arrayContaining(["title", "location", "date_needed", "require_photo_proof"]));
    expect(booked.size).toBeGreaterThan(12);
  });

  it("every column the edit dialog writes is locked once booked, or exempt with a reason", () => {
    const open = editDialogColumns().filter((c) => !booked.has(c) && !always.has(c) && !(c in EDIT_EXEMPT));
    expect(open, `poster-editable on a booked job: ${open.join(", ")}`).toEqual([]);
  });

  it("the exemption map is exact (two-way)", () => {
    const cols = editDialogColumns();
    expect(Object.keys(EDIT_EXEMPT).filter((c) => !cols.includes(c) || booked.has(c))).toEqual([]);
  });

  it("the place and scope columns the dialog does not write are locked too (the map pin, area, media, size)", () => {
    for (const c of ["parish", "zip_code", "latitude", "longitude", "photos", "scope_video_url", "estimated_hours"]) {
      expect(booked.has(c), `${c} must be in locked_when_booked`).toBe(true);
    }
  });

  it("the schedule-change flag unlocks the two schedule columns only", () => {
    const m = /IF\s+changed_col\s+IN\s*\('date_needed',\s*'start_time'\)\s+AND\s+current_setting\('app\.schedule_change_rpc',\s*true\)\s*=\s*'1'\s+THEN\s+CONTINUE;/.exec(lockBody);
    expect(m, "the carve-out must name date_needed and start_time").not.toBeNull();
  });

  it("photo proof can be relaxed but not raised once a Helpr is booked", () => {
    expect(lockBody).toMatch(/OLD\.require_photo_proof\s+IS\s+DISTINCT\s+FROM\s+TRUE\s+AND\s+NEW\.require_photo_proof\s+IS\s+TRUE\s+THEN\s+RAISE\s+EXCEPTION/i);
    expect(booked.has("require_photo_proof")).toBe(false);
  });

  it("server writes still pass first (the geocoder and purge_user_data write these columns)", () => {
    expect(lockBody.indexOf("public.is_server_context()")).toBeGreaterThan(-1);
    expect(lockBody.indexOf("public.is_server_context()")).toBeLessThan(lockBody.indexOf("locked_when_booked)"));
  });
});

describe("jobs.created_at is server-owned (Q1189)", () => {
  it("a poster's INSERT has created_at reset to now()", () => {
    expect(body("enforce_jobs_insert_column_lock")).toMatch(/NEW\.created_at\s*:=\s*now\(\)\s*;/);
  });
  it("a poster's UPDATE cannot change it", () => {
    expect(arrays("enforce_poster_jobs_money_lock").locked_always).toContain("created_at");
  });
});
