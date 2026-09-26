/**
 * Q147: the nightly backup carries the uploaded FILES, not only the
 * storage.objects rows that point at them, and the weekly drill proves they
 * restore. Owner decision 2026-09-23: every bucket except identity documents.
 *
 * Class stopped: a restore that brings back rows pointing at nothing (a dispute
 * proof photo, a credential), a bucket added later and silently left out, a
 * partial download reported as a backup, and an identity-document bucket copied
 * into a GitHub artifact.
 *
 * @mutate scripts/lib/storageBackup.mjs | if (o.bucket_id in EXCLUDED_BUCKETS) { | if (false) {
 * @mutate scripts/lib/storageBackup.mjs | if (want >= 0 && bytes.byteLength !== want) throw | if (false) throw
 * @mutate scripts/lib/storageBackup.mjs | if (!byKey.has(`${r.bucket_id}/${r.name}`)) problems.push | if (false) problems.push
 * @mutate .github/workflows/db-backup.yml | node scripts/storage-backup.mjs backup out/storage | echo skipped
 * @mutate .github/workflows/db-restore-drill.yml | node scripts/storage-backup.mjs verify | echo
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EXCLUDED_BUCKETS, backupObjects, verifyRestore, safeRelPath, sha256 } from "../../scripts/lib/storageBackup.mjs";
import { declaredBuckets } from "@/test/helpers/declaredBuckets";

const ROOT = resolve(__dirname, "..", "..");
const bytes = (s: string) => new TextEncoder().encode(s);
/** YAML with its whole-line `#` comments dropped, so a commented-out step never counts. */
const yaml = (p: string) => readFileSync(resolve(ROOT, p), "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

const OBJECTS = [
  { bucket_id: "proof-photos", name: "job-1/a.jpg", size: 3 },
  { bucket_id: "user-documents", name: "u1/credentials/licence.pdf", size: 4 },
  { bucket_id: "id-documents", name: "u1/front.jpg", size: 5 },
  { bucket_id: "avatars", name: "u1/.emptyFolderPlaceholder", size: 0 },
];
const STORE: Record<string, string> = { "proof-photos/job-1/a.jpg": "abc", "user-documents/u1/credentials/licence.pdf": "pdf!", "id-documents/u1/front.jpg": "IDIMG" };

async function run(over: Partial<Record<string, string | Error>> = {}) {
  const written: Record<string, Uint8Array> = {};
  const res = await backupObjects({
    objects: OBJECTS,
    download: async (b, n) => {
      const v = `${b}/${n}` in over ? over[`${b}/${n}`] : STORE[`${b}/${n}`];
      if (v instanceof Error) throw v;
      if (v === undefined) throw new Error("404");
      return bytes(v);
    },
    write: (rel, b) => { written[rel] = b; },
  });
  return { ...res, written };
}

describe("storage file backup (Q147)", () => {
  it("the owner's exclusion is exactly id-documents, with a reason", () => {
    expect(Object.keys(EXCLUDED_BUCKETS)).toEqual(["id-documents"]);
    expect(EXCLUDED_BUCKETS["id-documents"]).toMatch(/owner decision/);
  });

  it("every bucket the migrations declare is backed up (inclusion by default)", () => {
    const buckets = declaredBuckets();
    expect(buckets.length).toBeGreaterThan(4);
    for (const b of ["avatars", "job-photos", "proof-photos", "message-attachments", "user-documents"]) expect(buckets).toContain(b);
    expect(buckets.filter((b) => b in EXCLUDED_BUCKETS)).toEqual([]);
  });

  it("copies every non-excluded file with its hash, and never an excluded one", async () => {
    const { manifest, errors, written } = await run();
    expect(errors).toEqual([]);
    expect(Object.keys(written).sort()).toEqual(["proof-photos/job-1/a.jpg", "user-documents/u1/credentials/licence.pdf"]);
    expect(manifest.skipped).toEqual({ "id-documents": 1 });
    expect(manifest.files.find((f) => f.bucket === "proof-photos")?.sha256).toBe(sha256(bytes("abc")));
  });

  it("a failed download or a size mismatch is a FAILED backup", async () => {
    expect((await run({ "proof-photos/job-1/a.jpg": new Error("HTTP 500") })).errors).toHaveLength(1);
    expect((await run({ "proof-photos/job-1/a.jpg": "abcd" })).errors[0]).toMatch(/size 4, storage.objects says 3/);
  });

  it("refuses object names that could escape the output directory", () => {
    expect(() => safeRelPath("avatars", "../../etc/passwd")).toThrow();
    expect(() => safeRelPath("avatars", "/abs")).toThrow();
    expect(() => safeRelPath("../x", "a")).toThrow();
    expect(safeRelPath("avatars", "u1/a.png")).toBe("avatars/u1/a.png");
  });

  it("the drill check fails on a dangling restored row, a missing file, or changed bytes", async () => {
    const { manifest, written } = await run();
    const read = (rel: string) => written[rel] ?? null;
    const rows = OBJECTS.map(({ bucket_id, name }) => ({ bucket_id, name }));
    const ok = verifyRestore({ manifest, restoredRows: rows, read });
    expect(ok.problems).toEqual([]);
    expect(ok.checked).toBe(2);
    expect(verifyRestore({ manifest, restoredRows: [...rows, { bucket_id: "job-photos", name: "j/x.png" }], read }).problems[0]).toMatch(/points at a file the backup does not have/);
    expect(verifyRestore({ manifest, restoredRows: rows, read: (rel) => (rel.startsWith("proof") ? null : read(rel)) }).problems[0]).toMatch(/missing from the archive/);
    expect(verifyRestore({ manifest, restoredRows: rows, read: (rel) => (rel.startsWith("proof") ? bytes("abX") : read(rel)) }).problems[0]).toMatch(/bytes differ/);
  });

  it("the nightly backup runs it and archives it; the weekly drill verifies it", () => {
    const backup = yaml(".github/workflows/db-backup.yml");
    expect(backup).toMatch(/node scripts\/storage-backup\.mjs backup out\/storage/);
    expect(backup).toMatch(/tar czf "backup-\$STAMP\.tar\.gz" -C out [^\n]* storage\n/);
    expect(backup).toMatch(/grep -qx "storage\/manifest\.json" listing\.txt/);
    const drill = yaml(".github/workflows/db-restore-drill.yml");
    expect(drill).toMatch(/node scripts\/storage-backup\.mjs verify "\$RUNNER_TEMP\/sql\/storage" "\$RUNNER_TEMP\/restored-rows\.tsv"/);
  });
});
