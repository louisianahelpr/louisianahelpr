/**
 * Q1230 — job_views is server-only: the poster gets a COUNT, never the rows.
 *
 * WHAT WAS BROKEN (read live 2026-10-04): "Posters read views on own jobs"
 * (SELECT on job_views where the caller owns the job) plus table-level SELECT
 * for anon and authenticated handed a poster every viewer's user id through
 * PostgREST. The product shows counts only (get_job_view_counts, a definer
 * RPC), and the view itself is recorded by record_job_view (a definer RPC).
 *
 * THE CLASS, three layers:
 *   1. Grants: after every migration, neither anon nor authenticated holds
 *      any privilege on job_views, table-level or column-level (a later GRANT,
 *      including ON ALL TABLES IN SCHEMA public, would reopen it).
 *   2. Policies: no policy on job_views survives (a policy with no grant is
 *      dead weight, and the first grant to come back would make it a door).
 *   3. Client: nothing in src/ reads or writes job_views directly; it goes
 *      through record_job_view and get_job_view_counts.
 * Behaviour, red then green: src/test/pglite/jobViewsServerOnly.pglite.mjs.
 */
import { describe, it, expect } from "vitest";
import { join, relative } from "node:path";
import { readFileSync } from "node:fs";
import { migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";
import { replayTablePrivileges, livePolicies, type Priv } from "./helpers/tablePrivilegeReplay";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const files = () => migrationFiles(MIG_DIR).map((name) => ({ name, sql: readFileSync(join(MIG_DIR, name), "utf8") }));
const held = (e: ReturnType<typeof replayTablePrivileges>) => [
  ...[...e.table].map((p) => `${p} (table-level)`),
  ...[...e.cols].flatMap(([p, cs]: [Priv, Set<string>]) => [...cs].map((c) => `${p} (${c})`)),
];

describe("Q1230: job_views is server-only", () => {
  it.each(["anon", "authenticated"] as const)("%s holds no privilege on job_views after every migration", (role) => {
    expect(held(replayTablePrivileges(files(), "job_views", role))).toEqual([]);
  });

  it("no policy on job_views survives", () => {
    expect([...livePolicies(files(), "job_views").keys()]).toEqual([]);
  });

  it("the replay can fail: before 20261004185317 both roles held SELECT and the poster's policy stood", () => {
    const before = files().filter((f) => f.name < "20261004185317");
    expect(replayTablePrivileges(before, "job_views", "authenticated").table.has("SELECT")).toBe(true);
    expect(replayTablePrivileges(before, "job_views", "anon").table.has("SELECT")).toBe(true);
    expect([...livePolicies(before, "job_views").keys()]).toContain("Posters read views on own jobs");
    const regrant = [...files(), { name: "99999999999999_x.sql", sql: "GRANT SELECT (viewer_id) ON public.job_views TO authenticated;" }];
    expect(held(replayTablePrivileges(regrant, "job_views", "authenticated"))).toEqual(["SELECT (viewer_id)"]);
    const schemaWide = [...files(), { name: "99999999999999_y.sql", sql: "GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;" }];
    expect(replayTablePrivileges(schemaWide, "job_views", "anon").table.has("SELECT")).toBe(true);
    const toPublic = [...files(), { name: "99999999999999_z.sql", sql: "GRANT ALL ON TABLE public.job_views TO PUBLIC" }];
    expect(replayTablePrivileges(toPublic, "job_views", "authenticated").table.size).toBe(4);
  });

  it("the client never touches job_views directly; it uses the two definer RPCs", () => {
    const src = walkSource([join(ROOT, "src")]).filter((f) => !/\.test\.tsx?$|\/src\/test\/|\/integrations\//.test(f));
    expect(src.length).toBeGreaterThan(800);
    const direct: string[] = [];
    let rpcs = 0;
    for (const f of src) {
      const code = blankComments(readSource(f) ?? "");
      if (/\.from\(\s*["']job_views["']\s*\)/.test(code)) direct.push(relative(ROOT, f));
      if (/\.rpc\(\s*["'](?:record_job_view|get_job_view_counts)["']/.test(code)) rpcs++;
    }
    expect(direct).toEqual([]);
    expect(rpcs).toBeGreaterThanOrEqual(2);
  });
});

// @mutate supabase/migrations/20261004185317_job_views_server_only.sql | REVOKE ALL ON public.job_views FROM PUBLIC, anon, authenticated; | REVOKE ALL ON public.job_views FROM PUBLIC, anon;
// @mutate supabase/migrations/20261004185317_job_views_server_only.sql | DROP POLICY IF EXISTS "Posters read views on own jobs" ON public.job_views; |
// @mutate src/pages/posts/postedJobs/useJobAnalytics.ts | const { data, error } = await supabase.rpc("get_job_view_counts", { | void supabase.from("job_views").select("viewer_id"); const { data, error } = await supabase.rpc("get_job_view_counts", {
