/**
 * Declutter porch and problem photos live in a PRIVATE bucket
 * (20261015092723_declutter_handover_private_bucket; lh-authz-rls review of
 * slice 4, should-fix (a)). Read from the NEWEST definitions (effectiveDefs), so
 * a later restatement that points the RPCs back at the public job-photos bucket
 * fails here. Behaviour (18 checks, 3x replay, migration skipped = RED):
 * src/test/pglite/declutterHandoverBucket.pglite.mjs.
 *
 * @mutate supabase/migrations/20261015092723_declutter_handover_private_bucket.sql | VALUES ('declutter-handover', 'declutter-handover', false, | VALUES ('declutter-handover', 'declutter-handover', true,
 * @mutate supabase/migrations/20261015092723_declutter_handover_private_bucket.sql |      OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = p_photo_path) THEN |      OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'job-photos' AND so.name = p_photo_path) THEN
 * @mutate supabase/migrations/20261015092723_declutter_handover_private_bucket.sql |        OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'declutter-handover' AND so.name = v_path) THEN |        OR NOT EXISTS (SELECT 1 FROM storage.objects so WHERE so.bucket_id = 'job-photos' AND so.name = v_path) THEN
 * @mutate supabase/migrations/20261015092723_declutter_handover_private_bucket.sql |     RETURN split_part(p_name, '/', 1) = v_uid::text\n       AND EXISTS | RETURN EXISTS
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const MIG = blankSqlComments(readFileSync(join(MIG_DIR, "20261015092723_declutter_handover_private_bucket.sql"), "utf8"));

describe("Declutter handover photos: a private bucket (20261015092723)", () => {
  const RPCS = ["declutter_porch_photo", "declutter_report_problem"];
  it("reads a real inventory (floors)", () => {
    for (const fn of [...RPCS, "declutter_handover_photo_access"]) expect(body(fn), fn).not.toBe("");
    expect(RPCS.length).toBeGreaterThan(1);
  });

  it("the bucket is created PRIVATE, and a replay keeps it private", () => {
    expect(MIG).toMatch(/VALUES \('declutter-handover', 'declutter-handover', false,/);
    expect(MIG).toMatch(/ON CONFLICT \(id\) DO UPDATE SET\s+public = false/);
  });

  it("every RPC that takes a photo path accepts it only from the private bucket", () => {
    for (const fn of RPCS) {
      expect(body(fn), fn).toContain("so.bucket_id = 'declutter-handover'");
      expect(body(fn), fn).not.toContain("job-photos");
    }
  });

  it("uploads go into your own folder only; reads are the two parties and admins", () => {
    const b = body("declutter_handover_photo_access").replace(/\s+/g, " ");
    expect(b).toContain("RETURN split_part(p_name, '/', 1) = v_uid::text AND EXISTS");
    expect(b).toContain("public.has_role(v_uid, 'admin')");
    expect(MIG).toMatch(/FOR INSERT TO authenticated\s+WITH CHECK \(bucket_id = 'declutter-handover' AND public\.declutter_handover_photo_access\(name, true\)\)/);
    expect(MIG).toMatch(/FOR SELECT TO authenticated\s+USING \(bucket_id = 'declutter-handover' AND public\.declutter_handover_photo_access\(name, false\)\)/);
    // No member UPDATE or DELETE on evidence.
    expect(MIG).not.toMatch(/FOR (UPDATE|DELETE)[^;]*declutter-handover/);
  });
});
