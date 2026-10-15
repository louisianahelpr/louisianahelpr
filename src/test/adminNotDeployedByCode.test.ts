/**
 * GUARD (Q?admin-badge-not-deployed): no admin count or queue reads a real
 * failure as "not deployed yet".
 *
 * THE BUG (lh-authz-rls review of Q1691, 2026-10-14): src/components/admin/
 * adminRailBadges.ts read any error whose message contained "does not exist"
 * as 0, a test copied from AdminBanReview.tsx and AdminExceptionQueue.tsx.
 * Postgres words a renamed or dropped COLUMN the same way (42703 "column ...
 * does not exist"), so a schema change that broke one of those reads showed
 * as no badge, or as an empty review queue ("No accounts awaiting review"),
 * instead of an error. The Stuck Jobs count used isMissingRpc, which read the
 * same message text (and 42883/PGRST203, which come from INSIDE the RPC).
 *
 * THE FIX: the tables and the RPC behind those reads are on prod (measured
 * 2026-10-15, to_regclass / to_regprocedure), so the rail counts and the two
 * screens have no "not deployed" branch at all: every error reaches unwrap.
 * isMissingRpc (the Stuck Jobs screen's visible "not deployed yet" notice) is
 * PostgREST's PGRST202 with no hint only (measured on prod: a missing function
 * answers PGRST202 with a null hint; a changed signature carries a hint).
 *
 * THE CLASS, from the tree: every tracked non-test file under
 * src/components/admin and src/pages/admin. None may decide anything from an
 * error MESSAGE ("does not exist", "schema cache", "could not find the").
 *
 * @mutate src/components/admin/adminStalledJobs/stalledQueue.ts |   return e.code === "PGRST202" && !e.hint; |   return e.code === "PGRST202";
 * @mutate src/components/admin/adminStalledJobs/stalledQueue.ts |   return e.code === "PGRST202" && !e.hint; |   return e.code === "PGRST202" \|\| e.code === "42883";
 * @mutate src/components/admin/adminRailBadges.ts |       const rows = unwrap(res) ?? [];\n      const seed = await fetchSeedUserIds(rows.flatMap((r) => [r.customer_id, r.helper_id])); |       if (res.error && /does not exist/.test(res.error.message)) return 0;\n      const rows = unwrap(res) ?? [];\n      const seed = await fetchSeedUserIds(rows.flatMap((r) => [r.customer_id, r.helper_id]));
 * @mutate src/components/admin/adminRailBadges.ts |       const res = await supabase.from("verification_exceptions").select("user_id").eq("status", "open"); |       const res = await supabase.from("verification_exceptions").select("user_id").eq("status", "open");\n      if (res.error && res.error.code === "PGRST205") return 0;
 * @mutate src/components/admin/AdminBanReview.tsx |       const pending = (unwrap(result) ?? []) as ViolationRow[]; |       if (result.error && result.error.message?.includes("does not exist")) return [];\n      const pending = (unwrap(result) ?? []) as ViolationRow[];
 * @mutate src/components/admin/AdminExceptionQueue.tsx |       const baseRows = unwrap(result) ?? []; |       if (result.error && result.error.code === "PGRST202") return [];\n      const baseRows = unwrap(result) ?? [];
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isMissingRpc } from "@/components/admin/adminStalledJobs/stalledQueue";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

const read = (f: string) => blankComments(readFileSync(join(process.cwd(), f), "utf8"));
const adminFiles = [...trackedFiles("src/components/admin"), ...trackedFiles("src/pages/admin")].filter(
  (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f),
);
const MESSAGE_TEST = /does not exist|schema cache|could not find the/i;

/** The code from `start` to the next `useQuery(`/`queryFn` boundary: one read and what it does with the error. */
function readBlock(src: string, start: string): string {
  const i = src.indexOf(start);
  expect(i, `missing anchor ${start}`).toBeGreaterThan(-1);
  return src.slice(i, i + 1200);
}

describe("an admin count or queue never reads a real failure as 'not deployed' (Q?admin-badge-not-deployed)", () => {
  it("scans the admin tree (floor)", () => {
    expect(adminFiles.length).toBeGreaterThan(80);
  });

  it("no admin file decides anything from an error message", () => {
    expect(adminFiles.filter((f) => MESSAGE_TEST.test(read(f)))).toEqual([]);
  });

  it("isMissingRpc is a missing function only: PGRST202 with no hint", () => {
    expect(isMissingRpc({ code: "PGRST202", message: "Could not find the function", hint: null })).toBe(true);
    expect(isMissingRpc({ code: "42703", message: "column x does not exist" })).toBe(false);
    expect(isMissingRpc({ code: "42883", message: "function f() does not exist" })).toBe(false);
    expect(isMissingRpc({ code: "PGRST202", message: "Could not find", hint: "Perhaps you meant to call ..." })).toBe(false);
  });

  it("the rail's Ban Review, Exception Queue and Stuck Jobs counts send every error to unwrap", () => {
    const rail = read("src/components/admin/adminRailBadges.ts");
    for (const start of [
      'supabase.from("user_violations")',
      'supabase.from("verification_exceptions")',
      'supabase.rpc("admin_stalled_job_queue"',
    ]) {
      const block = readBlock(rail, start);
      const firstUse = block.slice(0, block.indexOf("unwrap("));
      expect(firstUse, start).not.toMatch(/\.error\b/);
      expect(firstUse, start).not.toMatch(/return 0/);
    }
  });

  it("Ban Review and Exception Queue have no empty-queue branch before unwrap", () => {
    for (const [f, start] of [
      ["src/components/admin/AdminBanReview.tsx", '.from("user_violations")'],
      ["src/components/admin/AdminExceptionQueue.tsx", '.from("verification_exceptions")'],
    ] as const) {
      const block = readBlock(read(f), start);
      const beforeUnwrap = block.slice(0, block.indexOf("unwrap(result)"));
      expect(block.indexOf("unwrap(result)"), f).toBeGreaterThan(0);
      expect(beforeUnwrap, f).not.toMatch(/\berror\b[^;]*\)\s*(\{\s*)?return/);
    }
  });
});
