/**
 * DR-004: after a database restore, rows point at Storage files that no backup
 * holds. scripts/check-storage-refs.mjs lists every such reference whose file
 * is gone; these pin its two halves.
 *
 *   1. INVENTORY (class): every public table column whose name looks like a
 *      file reference (types.ts) is either checked (STORAGE_REFERENCE_COLUMNS)
 *      or excluded with a reason (NOT_STORAGE_COLUMNS) — both ways, so a new
 *      photo/document column cannot be silently left out, and a dropped one
 *      cannot linger. Every default bucket is one the migrations declare.
 *   2. The value parser and the grading, on the real shapes the app stores
 *      (bare paths, public URLs, signed URLs, a foreign project after a
 *      restore into a new one, data: URLs, Google avatars).
 *
 * @mutate scripts/lib/storageRefs.mjs |   { table: "messages", column: "attachment_url", array: false, bucket: "message-attachments", writer: "src/lib/messageAttachments.ts (path)" },\n |
 * @mutate scripts/lib/storageRefs.mjs |     if (ref.host && projectHost && ref.host !== projectHost) {\n      result.foreign.push(r); |     if (false) {\n      result.foreign.push(r);
 * @mutate scripts/lib/storageRefs.mjs |     if (names.has(name)) result.present++; |     if (true) result.present++;
 */
import { describe, expect, it } from "vitest";
import {
  NOT_STORAGE_COLUMNS,
  STORAGE_REFERENCE_COLUMNS,
  CANDIDATE_COLUMN,
  foldersToList,
  gradeReferences,
  referencesFromRows,
  resolveStorageRef,
} from "../../scripts/lib/storageRefs.mjs";
import { declaredBuckets } from "./helpers/declaredBuckets";
import { publicTableColumns } from "./helpers/publicTableColumns";

const HOST = "fncmgoasalhdgfwzhsqa.supabase.co";
const PUB = (bucket: string, path: string) => `https://${HOST}/storage/v1/object/public/${bucket}/${path}`;

describe("storage reference inventory (class, from types.ts)", () => {
  const columns = publicTableColumns();
  const candidates = columns.filter((c) => CANDIDATE_COLUMN.test(c.split(".")[1]));
  const checked = STORAGE_REFERENCE_COLUMNS.map((c) => `${c.table}.${c.column}`);

  it("read the schema (cannot pass vacuously)", () => {
    expect(columns.length).toBeGreaterThan(500);
    expect(candidates.length).toBeGreaterThan(20);
  });

  it("every file-like column is checked or excluded with a reason", () => {
    const unaccounted = candidates.filter((c) => !checked.includes(c) && !(c in NOT_STORAGE_COLUMNS));
    expect(unaccounted).toEqual([]);
  });

  it("both lists name only columns that exist, and never the same one twice", () => {
    expect([...checked, ...Object.keys(NOT_STORAGE_COLUMNS)].filter((c) => !columns.includes(c))).toEqual([]);
    expect(checked.filter((c) => c in NOT_STORAGE_COLUMNS)).toEqual([]);
    expect(new Set(checked).size).toBe(checked.length);
  });

  it("every default bucket is a bucket the migrations declare", () => {
    const buckets = declaredBuckets();
    const named = STORAGE_REFERENCE_COLUMNS.map((c) => c.bucket).filter((b): b is string => !!b);
    expect(named.filter((b) => !buckets.includes(b))).toEqual([]);
  });
});

describe("resolveStorageRef", () => {
  it("reads a bare path as the column's bucket", () => {
    expect(resolveStorageRef("u1/credentials/license-1.png", "user-documents")).toEqual({
      kind: "object",
      bucket: "user-documents",
      path: "u1/credentials/license-1.png",
      host: null,
    });
  });

  it("reads public, signed and render URLs by their own bucket, decoded, without the query", () => {
    expect(resolveStorageRef(PUB("avatars", "u1/avatar.png?t=1"), "user-documents")).toMatchObject({ bucket: "avatars", path: "u1/avatar.png", host: HOST });
    expect(resolveStorageRef(`https://${HOST}/storage/v1/object/sign/proof-photos/j1/a%20b.png?token=x`, null)).toMatchObject({
      bucket: "proof-photos",
      path: "j1/a b.png",
    });
    expect(resolveStorageRef(`https://${HOST}/storage/v1/render/image/public/job-photos/j/p.png?width=200`, null)).toMatchObject({
      bucket: "job-photos",
      path: "j/p.png",
    });
  });

  it("does not mistake other URLs, data: URLs or junk for an object", () => {
    expect(resolveStorageRef("https://lh3.googleusercontent.com/a/x=s96-c", "avatars").kind).toBe("external");
    expect(resolveStorageRef("data:image/png;base64,iVBOR", "user-documents").kind).toBe("inline");
    expect(resolveStorageRef("", "avatars").kind).toBe("unresolved");
    expect(resolveStorageRef("some/path.png", null).kind).toBe("unresolved");
    expect(resolveStorageRef("../../etc/passwd", "avatars").kind).toBe("unresolved");
  });
});

describe("gradeReferences", () => {
  const avatars = STORAGE_REFERENCE_COLUMNS.find((c) => c.table === "profiles" && c.column === "avatar_url")!;
  const proof = STORAGE_REFERENCE_COLUMNS.find((c) => c.table === "jobs" && c.column === "proof_after_urls")!;

  it("finds a restored row whose file is gone, and passes one whose file is there", () => {
    const refs = [
      ...referencesFromRows(avatars, [
        { id: "p1", avatar_url: PUB("avatars", "u1/avatar.png") },
        { id: "p2", avatar_url: PUB("avatars", "u2/avatar.jpg") },
      ]),
      ...referencesFromRows(proof, [{ id: "j1", proof_after_urls: ["j1/after-1.png", "j1/after-2.png"] }]),
    ];
    expect(foldersToList(refs, HOST)).toEqual([
      { bucket: "avatars", dir: "u1" },
      { bucket: "avatars", dir: "u2" },
      { bucket: "proof-photos", dir: "j1" },
    ]);
    const listed = new Map([
      ["avatars/u1", new Set(["avatar.png"])],
      ["avatars/u2", new Set<string>()], // purged after the backup
      ["proof-photos/j1", new Set(["after-1.png"])],
    ]);
    const g = gradeReferences(refs, listed, HOST);
    expect(g.checked).toBe(4);
    expect(g.present).toBe(2);
    expect(g.missing.map((m) => `${m.table}.${m.column}:${m.id}`)).toEqual(["profiles.avatar_url:p2", "jobs.proof_after_urls:j1"]);
  });

  it("flags every URL on another project after a restore into a new one", () => {
    const refs = referencesFromRows(avatars, [{ id: "p1", avatar_url: PUB("avatars", "u1/avatar.png") }]);
    const g = gradeReferences(refs, new Map([["avatars/u1", new Set(["avatar.png"])]]), "newprojectref.supabase.co");
    expect(g.foreign).toHaveLength(1);
    expect(g.present).toBe(0);
  });

  it("never reads a folder it could not list as 'missing' (or as present)", () => {
    const refs = referencesFromRows(proof, [{ id: "j1", proof_after_urls: ["j1/a.png"] }]);
    const g = gradeReferences(refs, new Map(), HOST);
    expect(g.unlisted).toHaveLength(1);
    expect(g.missing).toHaveLength(0);
    expect(g.present).toBe(0);
  });
});
