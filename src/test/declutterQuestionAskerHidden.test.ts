/**
 * Q2278 (lead ruling 2026-10-21): who asked a Declutter question is never readable by other members, the seller
 * included ("Asked by a neighbor"). Replayed from every migration: members hold no table-level SELECT on
 * declutter_questions and no column grant on asker_id; and the declutter_offers / declutter_offer_events read stays
 * revoked (Q2267). The client never selects asker_id.
 *
 * @mutate supabase/migrations/20261021044114_declutter_questions_hide_asker.sql | REVOKE SELECT ON public.declutter_questions FROM anon, authenticated; | -- revoke removed
 * @mutate supabase/migrations/20261021044114_declutter_questions_hide_asker.sql | GRANT SELECT (id, item_id, question, | GRANT SELECT (id, item_id, asker_id, question,
 * @mutate supabase/migrations/20261021031757_declutter_wanted_public_replies.sql | REVOKE SELECT ON public.declutter_offers FROM anon, authenticated; | -- revoke removed
 * @mutate src/lib/declutter/api.ts |       .select("id, item_id, question, answer, answered_at, created_at") |       .select("id, item_id, asker_id, question, answer, answered_at, created_at")
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { migrationFiles } from "./helpers/effectiveFunctionDefs";
import { replayTablePrivileges } from "./helpers/tablePrivilegeReplay";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

const MIG_DIR = resolve(__dirname, "../../supabase/migrations");
const files = () => migrationFiles(MIG_DIR).map((name) => ({ name, sql: readFileSync(join(MIG_DIR, name), "utf8") }));

describe("Q2278 / Q2267: counterparties are not readable before a deal", () => {
  it("members read declutter_questions only through columns without asker_id", () => {
    const e = replayTablePrivileges(files(), "declutter_questions", "authenticated");
    expect(e.table.has("SELECT")).toBe(false);
    const cols = e.cols.get("SELECT")!;
    expect(cols.size).toBeGreaterThan(4);
    expect(cols.has("question")).toBe(true);
    expect(cols.has("asker_id")).toBe(false);
  });

  it("members hold no read of declutter_offers / declutter_offer_events (the poster's id)", () => {
    for (const t of ["declutter_offers", "declutter_offer_events"]) {
      const e = replayTablePrivileges(files(), t, "authenticated");
      expect(e.table.has("SELECT"), t).toBe(false);
      expect([...(e.cols.get("SELECT") ?? [])], t).toEqual([]);
    }
  });

  it("no app read of declutter_questions asks for asker_id or * (members have no grant on it)", () => {
    let reads = 0;
    for (const f of trackedFiles("src").filter((p) => /\.(ts|tsx)$/.test(p) && !p.startsWith("src/test/") && !/\.test\.tsx?$/.test(p))) {
      const src = blankComments(readFileSync(resolve(__dirname, "../..", f), "utf8"));
      for (const m of src.matchAll(/from\("declutter_questions"\)\s*\.select\(\s*"([^"]*)"/g)) {
        reads++;
        expect(m[1], f).not.toMatch(/asker_id|\*/);
      }
    }
    expect(reads).toBeGreaterThan(0);
  });
});
