// @mutate supabase/migrations/20261123090717_proof_photos_attached_are_immutable.sql | ON storage.objects FOR DELETE TO authenticated\n  USING (\n    bucket_id = 'proof-photos'\n    AND (storage.foldername(name))[2] IS DISTINCT FROM 'disputes'\n    AND owner = (select auth.uid()) | ON storage.objects FOR DELETE TO authenticated\n  USING (\n    bucket_id = 'proof-photos'\n    AND (storage.foldername(name))[2] IS DISTINCT FROM 'disputes'
// @mutate supabase/migrations/20261123090717_proof_photos_attached_are_immutable.sql |     )\n    AND NOT public.proof_photo_object_attached(name)\n  );\n\nDROP POLICY IF EXISTS "Users can delete | \n    )\n  );\n\nDROP POLICY IF EXISTS "Users can delete
// @mutate supabase/migrations/20261123090717_proof_photos_attached_are_immutable.sql |     OR EXISTS (\n      SELECT 1 FROM public.job_revisions r | OR EXISTS (\n      SELECT 1 FROM public.job_revisions r WHERE false AND
// @mutate supabase/migrations/20261123090717_proof_photos_attached_are_immutable.sql |       SELECT 1 FROM public.group_job_helpers g\n       WHERE p_name = ANY (g.proof_before_urls) |       SELECT 1 FROM public.group_job_helpers g\n       WHERE false AND p_name = ANY (g.proof_before_urls)
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";

/**
 * SEC-1123-01 (backend security audit 2026-11-23): a party to a job could delete or overwrite the OTHER side's
 * attached proof photos. The proof-photos UPDATE/DELETE policies let both the poster and the Helpr touch every
 * object under `<jobId>/`, and those photos gate completion and payout and are what an admin sees in a dispute.
 * Fix: 20261123090717_proof_photos_attached_are_immutable.sql.
 *
 * CLASS, from the app's own inventory:
 *   1. replaying every storage.objects CREATE/DROP POLICY in migration order (comments blanked), every surviving
 *      UPDATE, DELETE or ALL policy on proof-photos lets only the object's uploader act (`owner = auth.uid()`) and
 *      only on an object no job names (`NOT public.proof_photo_object_attached(name)`);
 *   2. the live proof_photo_object_attached reads every place a client attaches a proof-photos path: the client
 *      upload sites to proof-photos outside `/disputes/` are exactly PhotoProof (jobs.proof_before_urls /
 *      proof_after_urls) and CompletionChoiceSheet (job_revisions.photos). A new upload site fails here until the
 *      attached check reads where it attaches.
 * Behaviour: src/test/pglite/proofPhotosAttachedAreImmutable.pglite.mjs — ALL PASS; NEW_MIGRATION=skip -> 10 FAILED.
 */

const ROOT = join(__dirname, "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const files = migrationFiles(MIG);
const ws = (s: string) => s.replace(/\s+/g, " ").trim();

function storagePolicies(): Map<string, { cmd: string; text: string; file: string }> {
  const live = new Map<string, { cmd: string; text: string; file: string }>();
  const stmt = /(CREATE|DROP)\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+storage\.objects\b([^;]*);/gi;
  for (const file of files) {
    const sql = blankSqlComments(readFileSync(join(MIG, file), "utf8"));
    for (const m of sql.matchAll(stmt)) {
      const [, verb, name, rest] = m;
      if (verb.toUpperCase() === "DROP") live.delete(name);
      else live.set(name, { cmd: (rest.match(/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i)?.[1] ?? "ALL").toUpperCase(), text: ws(rest), file });
    }
  }
  return live;
}

/** Client files that upload to proof-photos with a path that is not dispute evidence. */
function proofUploaders(): string[] {
  const out = new Set<string>();
  for (const file of walkSource([join(ROOT, "src")])) {
    if (/\.test\.|__tests__/.test(file)) continue;
    const src = readSource(file);
    if (!src) continue;
    const code = blankComments(src);
    if (!/\.from\(\s*["']proof-photos["']\s*\)\s*\.upload\(/.test(code)) continue;
    // Every `proof-photos` path built in the file; dispute-only uploaders build only `/disputes/` paths.
    const paths = [...code.matchAll(/const path = `([^`]*)`/g)].map((m) => m[1]);
    if (paths.length === 0 || paths.some((p) => !p.includes("/disputes/"))) out.add(file.slice(ROOT.length + 1));
  }
  return [...out].sort();
}

describe("attached proof photos are immutable to clients (SEC-1123-01)", () => {
  const policies = storagePolicies();

  it("every client UPDATE/DELETE on proof-photos is the uploader's, on an unattached object", () => {
    expect(policies.size).toBeGreaterThan(20);
    const writers = [...policies].filter(([, p]) => ["UPDATE", "DELETE", "ALL"].includes(p.cmd) && p.text.includes("'proof-photos'"));
    expect(writers.length).toBeGreaterThan(1);
    const open = writers
      .filter(([, p]) => !p.text.includes("AND owner = (select auth.uid())") || !p.text.includes("AND NOT public.proof_photo_object_attached(name)"))
      .map(([name, p]) => `${name} (${p.cmd}, ${p.file})`);
    expect(open).toEqual([]);
  });

  it("the attached check reads every place a client attaches a proof photo", () => {
    expect(proofUploaders()).toEqual(["src/components/PhotoProof.tsx", "src/pages/posts/CompletionChoiceSheet.tsx"]);
    const fn = effectiveDefs(MIG).get("proof_photo_object_attached");
    expect(fn, "proof_photo_object_attached is not live").toBeTruthy();
    const body = ws(blankSqlComments(fn!.stmt));
    expect(body).toMatch(/SECURITY DEFINER/i);
    expect(body).toContain("p_name = ANY (j.proof_before_urls)");
    expect(body).toContain("p_name = ANY (j.proof_after_urls)");
    expect(body).toMatch(/FROM public\.job_revisions r WHERE p_name = ANY \(r\.photos\)/);
    // PhotoProof's crew branch attaches to the roster row.
    expect(body).toMatch(/FROM public\.group_job_helpers g WHERE p_name = ANY \(g\.proof_before_urls\) OR p_name = ANY \(g\.proof_after_urls\)/);
    // The client writes what the check reads.
    expect(blankComments(readFileSync(join(ROOT, "src/components/PhotoProof.tsx"), "utf8"))).toMatch(/proof_\$\{type\}_urls|proof_before_urls|proof_after_urls/);
    expect(blankComments(readFileSync(join(ROOT, "src/pages/posts/CompletionChoiceSheet.tsx"), "utf8"))).toMatch(/from\("job_revisions"\)\.insert\(\{[\s\S]{0,200}photos: photoPaths/);
  });
});
