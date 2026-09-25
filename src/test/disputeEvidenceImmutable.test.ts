// @mutate supabase/migrations/20260925141905_dispute_evidence_immutable_to_parties.sql | CREATE POLICY "Users can delete their own proof photos"\n  ON storage.objects FOR DELETE TO authenticated\n  USING (\n    bucket_id = 'proof-photos'\n    AND (storage.foldername(name))[2] IS DISTINCT FROM 'disputes' | CREATE POLICY "Users can delete their own proof photos"\n  ON storage.objects FOR DELETE TO authenticated\n  USING (\n    bucket_id = 'proof-photos'
// @mutate supabase/migrations/20260925141905_dispute_evidence_immutable_to_parties.sql | CREATE POLICY "Users can update their own proof photos"\n  ON storage.objects FOR UPDATE TO authenticated\n  USING (\n    bucket_id = 'proof-photos'\n    AND (storage.foldername(name))[2] IS DISTINCT FROM 'disputes' | CREATE POLICY "Users can update their own proof photos"\n  ON storage.objects FOR UPDATE TO authenticated\n  USING (\n    bucket_id = 'proof-photos'
// @mutate src/components/DisputeDialog.tsx | await supabase.storage.from("proof-photos").upload(path, file); | await supabase.storage.from("dispute-files").upload(path, file);
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";

/**
 * Dispute evidence cannot be swapped or deleted by a party after it is filed.
 *
 * The dispute dialogs upload evidence to a storage bucket at
 * `<uid>/disputes/<jobId>/<file>` and file the PATH; an admin signs and views
 * it when deciding the money split. Until 20260925141905 the proof-photos
 * UPDATE/DELETE policies allowed any `<uid>/…` object, so the filer could
 * overwrite or delete a photo after an admin had seen it.
 *
 * CLASS, from the app's own inventory: every bucket any client file uploads a
 * `/disputes/` path to is an evidence bucket. Replaying every storage.objects
 * CREATE/DROP POLICY in migration order (comments blanked), each surviving
 * UPDATE, DELETE or ALL policy on an evidence bucket must carry
 * `(storage.foldername(name))[2] IS DISTINCT FROM 'disputes'`.
 *
 * Behaviour on the live policies (applied 3x):
 * src/test/pglite/disputeEvidenceImmutable.pglite.mjs — ALL PASS;
 * NEW_MIGRATION=skip -> 3 FAILED.
 */

const ROOT = join(__dirname, "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const ws = (s: string) => s.replace(/\s+/g, " ").trim();

/** Buckets a client file uploads a `/disputes/` path to. */
function evidenceBuckets(): { buckets: string[]; uploaders: string[] } {
  const buckets = new Set<string>();
  const uploaders: string[] = [];
  for (const file of walkSource([join(ROOT, "src")])) {
    if (/\.test\.|__tests__/.test(file)) continue;
    const src = readSource(file);
    if (!src) continue;
    const code = blankComments(src);
    if (!/\/disputes\//.test(code)) continue;
    for (const m of code.matchAll(/\.from\(\s*["']([\w-]+)["']\s*\)\s*\.upload\(/g)) {
      buckets.add(m[1]);
      uploaders.push(file.slice(ROOT.length + 1));
    }
  }
  return { buckets: [...buckets].sort(), uploaders: [...new Set(uploaders)].sort() };
}

/** Final state of every storage.objects policy, replaying CREATE/DROP POLICY in migration order. */
function storagePolicies(): Map<string, { cmd: string; text: string; file: string }> {
  const live = new Map<string, { cmd: string; text: string; file: string }>();
  const stmt = /(CREATE|DROP)\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+storage\.objects\b([^;]*);/gi;
  for (const file of files) {
    const sql = blankSqlComments(readFileSync(join(MIG, file), "utf8"));
    for (const m of sql.matchAll(stmt)) {
      const [, verb, name, rest] = m;
      if (verb.toUpperCase() === "DROP") live.delete(name);
      else {
        const cmd = (rest.match(/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i)?.[1] ?? "ALL").toUpperCase();
        live.set(name, { cmd, text: ws(rest), file });
      }
    }
  }
  return live;
}

describe("dispute evidence is immutable to the parties", () => {
  const { buckets, uploaders } = evidenceBuckets();
  const policies = storagePolicies();

  it("the inventory is real", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(policies.size).toBeGreaterThan(20);
    // Both dispute dialogs upload evidence.
    expect(uploaders.length).toBeGreaterThan(1);
    expect(buckets.length).toBeGreaterThan(0);
  });

  it("evidence goes only to buckets whose party policies are pinned here", () => {
    // A new evidence bucket needs its policies checked below, not skipped.
    expect(buckets).toEqual(["proof-photos"]);
  });

  it("every party UPDATE/DELETE policy on an evidence bucket excludes the disputes folder", () => {
    const writers = [...policies].filter(
      ([, p]) => ["UPDATE", "DELETE", "ALL"].includes(p.cmd) && buckets.some((b) => p.text.includes(`'${b}'`)),
    );
    // The proof-photos UPDATE and DELETE policies, at least.
    expect(writers.length).toBeGreaterThan(1);
    const open = writers
      .filter(([, p]) => !p.text.includes("(storage.foldername(name))[2] IS DISTINCT FROM 'disputes'"))
      .map(([name, p]) => `${name} (${p.cmd}, ${p.file})`);
    expect(open).toEqual([]);
  });
});
