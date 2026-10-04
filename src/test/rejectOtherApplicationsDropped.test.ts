/**
 * Q1216 — reject_other_applications_on_accept is gone, and nothing calls it.
 *
 * Its last caller (useOfferHandlers.ts's PGRST202 accept fallback) was
 * retired by Q1187; complete_job_accept closes the other applications itself.
 * Callers counted 2026-10-04 in live pg_proc (none; one comment), cron.job
 * (none), the migrations, supabase/functions, src/ and e2e/ (none), so
 * 20261004193221 drops it. This pins both halves: the migrations leave no
 * definition, and no app, edge function or e2e spec calls it (a call would be
 * a PGRST202 at runtime).
 * Behaviour: src/test/pglite/rejectOtherApplicationsDropped.pglite.mjs
 * (applied 3x: ALL PASS; NEW_MIGRATION=skip: 2 FAILED).
 */
import { describe, it, expect } from "vitest";
import { join, relative } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";

const ROOT = process.cwd();
const FN = "reject_other_applications_on_accept";

describe("Q1216: the uncalled accept helper RPC is dropped", () => {
  it("no migration leaves a definition", () => {
    const defs = effectiveDefs(join(ROOT, "supabase/migrations"));
    expect(defs.size).toBeGreaterThan(100);
    expect(defs.has("complete_job_accept"), "the replacement writer is gone too: the scan is blind").toBe(true);
    expect(defs.has(FN)).toBe(false);
  });

  it("nothing calls it: app, edge functions, e2e", () => {
    const files = walkSource([join(ROOT, "src"), join(ROOT, "supabase/functions"), join(ROOT, "e2e")])
      .filter((f) => !/\.test\.tsx?$|\/src\/test\/|\/integrations\/supabase\/types\.ts$/.test(f));
    expect(files.length).toBeGreaterThan(900);
    const hits = files.filter((f) => blankComments(readSource(f) ?? "").includes(FN)).map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });
});

// @mutate supabase/migrations/20261004193221_drop_reject_other_applications_on_accept.sql | DROP FUNCTION IF EXISTS public.reject_other_applications_on_accept(uuid, uuid); |
