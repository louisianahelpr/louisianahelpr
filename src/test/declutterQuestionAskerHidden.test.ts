/**
 * Q2278 (lead ruling 2026-10-21): who asked a Declutter question is never readable by other members, the seller
 * included (the item page says "Asked by a neighbor"). The app reads an item's questions through
 * declutter_item_questions (20261021122157), which never returns asker_id and reads as the caller (SECURITY INVOKER),
 * so the table's row policy still decides. Its fallback while that RPC is not deployed reads the table without
 * asker_id. No app read of the table asks for asker_id or *, so the column grant can be narrowed later
 * (ready/declutter-narrow-floor2) without breaking this build.
 *
 * @mutate src/lib/declutter/api.ts |         .select("id, item_id, question, answer, answered_at, created_at") |         .select("id, item_id, asker_id, question, answer, answered_at, created_at")
 * @mutate supabase/migrations/20261021122157_declutter_item_questions.sql |     SELECT q.id, q.item_id, q.question, |     SELECT q.id, q.item_id, q.asker_id AS question,
 * @mutate supabase/migrations/20261021122157_declutter_item_questions.sql | STABLE\nSECURITY INVOKER | STABLE\nSECURITY DEFINER
 * @mutate src/lib/declutter/api.ts |   const res = await supabase.rpc("declutter_item_questions", { p_item_id: itemId }); |   const res = { error: { code: "PGRST202" } } as never;
 *
 * The narrowing itself (ready/declutter-narrow-floor2, 20261021124810, with client_compat_floor() 2), replayed from
 * every migration: members hold no table-level SELECT on declutter_questions and no column grant on asker_id, and no
 * read of declutter_offers / declutter_offer_events (the Wanted poster's id on a reply, Q2267 / Q2274).
 * @mutate supabase/migrations/20261021124810_declutter_narrow_member_reads.sql | REVOKE SELECT ON public.declutter_questions FROM anon, authenticated; | -- revoke removed
 * @mutate supabase/migrations/20261021124810_declutter_narrow_member_reads.sql | GRANT SELECT (id, item_id, question, | GRANT SELECT (id, item_id, asker_id, question,
 * @mutate supabase/migrations/20261021124810_declutter_narrow_member_reads.sql | REVOKE SELECT ON public.declutter_offers FROM anon, authenticated; | -- revoke removed
 * @mutate supabase/migrations/20261021124810_declutter_narrow_member_reads.sql | REVOKE SELECT ON public.declutter_offer_events FROM anon, authenticated; | -- revoke removed
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";
import { migrationFiles } from "./helpers/effectiveFunctionDefs";
import { replayTablePrivileges } from "./helpers/tablePrivilegeReplay";

const ROOT = resolve(__dirname, "../..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");

const migrations = () => migrationFiles(MIG_DIR).map((name) => ({ name, sql: readFileSync(resolve(MIG_DIR, name), "utf8") }));

const appSources = () =>
  trackedFiles("src")
    .filter((p) => /\.(ts|tsx)$/.test(p) && !p.startsWith("src/test/") && !/\.test\.tsx?$/.test(p))
    .map((f) => ({ f, src: blankComments(readFileSync(resolve(ROOT, f), "utf8")) }));

describe("Q2278: the app never reads who asked a Declutter question", () => {
  it("declutter_item_questions returns no asker_id and reads as the caller", () => {
    const def = effectiveDefs(MIG_DIR).get("declutter_item_questions");
    expect(def, "declutter_item_questions is defined").toBeTruthy();
    const body = blankSqlComments(def!.stmt);
    expect(body).toMatch(/\bSECURITY\s+INVOKER\b/i);
    expect(body).not.toMatch(/\bSECURITY\s+DEFINER\b/i);
    expect(body).not.toMatch(/\basker_id\b/i);
    expect(body).toMatch(/require_feature\('declutter'\)/);
  });

  it("the app calls declutter_item_questions for an item's questions", () => {
    const callers = appSources().filter(({ src }) => /\.rpc\(\s*"declutter_item_questions"/.test(src));
    expect(callers.map((c) => c.f)).toEqual(["src/lib/declutter/api.ts"]);
  });

  it("no app read of declutter_questions asks for asker_id or * (inventory floor: the fallback read)", () => {
    let reads = 0;
    const sources = appSources();
    // Floor: 1484 app source files scanned on 2026-10-21.
    expect(sources.length).toBeGreaterThan(1350);
    for (const { f, src } of sources) {
      for (const m of src.matchAll(/from\("declutter_questions"\)\s*\.select\(\s*"([^"]*)"/g)) {
        reads++;
        expect(m[1], f).not.toMatch(/asker_id|\*/);
      }
      // A select with no column list reads every column, asker_id included.
      expect(/from\("declutter_questions"\)\s*\.select\(\s*\)/.test(src), f).toBe(false);
    }
    expect(reads).toBeGreaterThan(0);
  });

  it("members read declutter_questions only through columns without asker_id (replayed from every migration)", () => {
    const e = replayTablePrivileges(migrations(), "declutter_questions", "authenticated");
    expect(e.table.has("SELECT")).toBe(false);
    const cols = e.cols.get("SELECT")!;
    expect(cols.size).toBeGreaterThan(4);
    expect(cols.has("question")).toBe(true);
    expect(cols.has("asker_id")).toBe(false);
  });

  it("members hold no read of declutter_offers / declutter_offer_events (the Wanted poster's id)", () => {
    for (const t of ["declutter_offers", "declutter_offer_events"]) {
      const e = replayTablePrivileges(migrations(), t, "authenticated");
      expect(e.table.has("SELECT"), t).toBe(false);
      expect([...(e.cols.get("SELECT") ?? [])], t).toEqual([]);
    }
  });
});
