/**
 * CLASS GUARD: a client-side upload size cap never exceeds the file_size_limit
 * of the bucket it uploads to.
 *
 * WHY. A client cap is there so a file the bucket would refuse is refused
 * FIRST, with copy a person can act on. A cap above the bucket's limit lets a
 * file through that storage then rejects with a raw error, or, where the
 * upload runs after the job posts and is non-fatal (the scope video), with no
 * message at all. The message-attachments voice-note cap was 10 MB over a
 * 5 MB bucket (archive L3129, found 2026-09-14), and the scope video had no
 * cap over a 50 MB bucket (archive L2889).
 *
 * HOW, derived both ways from source:
 *   bucket limits  <- supabase/migrations replayed in order
 *                     (computeState in storageBucketLimits.test.ts)
 *   client caps    <- every non-test file under src/ that names exactly ONE
 *                     bucket id as a string literal; every `N * 1024 * 1024`
 *                     byte expression in its code (comments blanked) is that
 *                     file's cap for that bucket.
 * A file with a byte cap that names no bucket, or several, is not judged; the
 * inventory floor below fails if the binding stops finding the known sites.
 */
// @mutate src/lib/messageAttachments.ts | const VOICE_NOTE_MAX_BYTES = 5 * 1024 * 1024; | const VOICE_NOTE_MAX_BYTES = 10 * 1024 * 1024;
// @mutate src/lib/scopeVideo.ts | export const SCOPE_VIDEO_MAX_BYTES = 50 * 1024 * 1024; | export const SCOPE_VIDEO_MAX_BYTES = 60 * 1024 * 1024;
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { computeState } from "./storageBucketLimits.test";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");

function listSrc(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === "test" || e === "__tests__") continue;
      out.push(...listSrc(p));
    } else if (/\.(?:ts|tsx)$/.test(e) && !/\.(?:test|spec)\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

export type ClientCap = { file: string; line: number; bucket: string; bytes: number; expr: string };

/** Byte caps in one file's code, bound to the one bucket the file names. */
export function capsIn(rel: string, text: string, bucketIds: string[]): ClientCap[] {
  const code = blankComments(text);
  const named = bucketIds.filter((id) => new RegExp(`["'\`]${id.replace(/-/g, "\\-")}["'\`]`).test(code));
  if (named.length !== 1) return [];
  const caps: ClientCap[] = [];
  for (const m of code.matchAll(/\b(\d+)\s*\*\s*1024\s*\*\s*1024\b/g)) {
    caps.push({
      file: rel,
      line: code.slice(0, m.index).split("\n").length,
      bucket: named[0],
      bytes: Number(m[1]) * 1024 * 1024,
      expr: m[0],
    });
  }
  return caps;
}

describe("client upload caps stay within their bucket's file_size_limit", () => {
  const state = computeState();
  const bucketIds = [...state.keys()];
  const caps = listSrc(join(ROOT, "src")).flatMap((f) =>
    capsIn(relative(ROOT, f).split("\\").join("/"), readFileSync(f, "utf8"), bucketIds),
  );

  it("finds the buckets' limits and the client caps (cannot pass vacuously)", () => {
    expect(state.get("message-attachments")?.size).toBe(5 * 1024 * 1024);
    expect(state.get("job-photos")?.size).toBe(50 * 1024 * 1024);
    expect(caps.length).toBeGreaterThan(10);
    expect(new Set(caps.map((c) => c.bucket)).size).toBeGreaterThan(5);
    expect(caps.some((c) => c.file === "src/lib/scopeVideo.ts" && c.bucket === "job-photos")).toBe(true);
    expect(caps.some((c) => c.file === "src/lib/messageAttachments.ts" && c.bucket === "message-attachments")).toBe(true);
  });

  it("every bound bucket has a declared numeric limit", () => {
    const unknown = [...new Set(caps.map((c) => c.bucket))].filter((b) => state.get(b)?.size == null);
    expect(unknown).toEqual([]);
  });

  it("no client cap is larger than its bucket's limit", () => {
    const over = caps
      .filter((c) => c.bytes > (state.get(c.bucket)?.size ?? Infinity))
      .map((c) => `${c.file}:${c.line} ${c.expr} > ${c.bucket} limit ${state.get(c.bucket)?.size}`);
    expect(over).toEqual([]);
  });

  it("RED on the original defect: a 10 MB voice-note cap over the 5 MB message-attachments bucket", () => {
    const original = `const MESSAGE_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
      const VOICE_NOTE_MAX_BYTES = 10 * 1024 * 1024;
      supabase.storage.from("message-attachments").upload(path, blob);`;
    const over = capsIn("src/lib/messageAttachments.ts", original, bucketIds).filter(
      (c) => c.bytes > (state.get(c.bucket)?.size ?? Infinity),
    );
    expect(over.map((c) => c.expr)).toEqual(["10 * 1024 * 1024"]);
  });
});
