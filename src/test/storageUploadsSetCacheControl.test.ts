/**
 * Q655 class — every storage-js `.upload(` says how long its object may be cached.
 *
 * storage-js defaults to `cacheControl: "3600"`, so a photo whose URL never
 * changes was re-downloaded every hour (measured by Q56: 192 objects at
 * max-age=3600). Every upload in src/ and supabase/functions/ now passes
 * cacheControl explicitly:
 *
 * - a year (IMMUTABLE_OBJECT_CACHE_CONTROL / "31536000") when the key is unique
 *   per upload or its URL is versioned (avatars carry `?t=`);
 * - an hour (MUTABLE_OBJECT_CACHE_CONTROL / "3600") only for a fixed key that
 *   is overwritten in place and served at an unversioned URL.
 *
 * `upsert: true` is the tell for an overwritten key, so every upsert site must
 * be named in exactly one list below: MUTABLE_KEY_UPLOADS (keeps an hour) or
 * UPSERT_BUT_VERSIONED (unique key or versioned URL, so a year). Both lists are
 * exact both ways. A site is named `<file>#<n>`, n = its 0-based `.upload(`
 * occurrence in that file (comments blanked).
 *
 * Raw-HTTP uploads (x-upsert headers in scripts/e2e) are rawStorageUploadsSetCacheControl.test.ts.
 */
// @mutate src/components/PhotoProof.tsx | .upload(path, file, { cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL }); | .upload(path, file);
// @mutate src/lib/portfolioStorage.ts | { upsert: false, contentType, cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL }); | { upsert: false, contentType });
// @mutate src/pages/post-job/useJobMediaUpload.ts | const { error: vidErr } = await supabase.storage\n          .from(SCOPE_VIDEO_BUCKET)\n          .upload(path, scopeVideoFile, { upsert: true, cacheControl: MUTABLE_OBJECT_CACHE_CONTROL }); | const { error: vidErr } = await supabase.storage\n          .from(SCOPE_VIDEO_BUCKET)\n          .upload(path, scopeVideoFile, { upsert: true, cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL });
// @mutate supabase/functions/complete-signup/index.ts | cacheControl: "31536000", // unique key per upload (Q655)\n        });\n      if (licErr) | cacheControl: "3600",\n        });\n      if (licErr)
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { walkSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");

const MUTABLE_KEY_UPLOADS = [
  "src/pages/post-job/useJobMediaUpload.ts#1", // `${jobId}/scope-video.<ext>`
  "src/pages/post-job/useJobMediaUpload.ts#2", // same key, the edit-job path
  "supabase/functions/complete-signup/index.ts#0", // `<uid>/avatar.<ext>`, URL stored without ?t=
];
const UPSERT_BUT_VERSIONED = [
  "src/components/profile/CredentialsTab.tsx#0", // `${kind}-${Date.now()}`
  "src/lib/avatarStorage.ts#0", // fixed key, stored URL carries ?t=
  "supabase/functions/complete-signup/index.ts#1", // license-${Date.now()}
  "supabase/functions/complete-signup/index.ts#2", // insurance-${Date.now()}
];

const YEAR = /cacheControl\s*:\s*(IMMUTABLE_OBJECT_CACHE_CONTROL|["']31536000["'])/;
const HOUR = /cacheControl\s*:\s*(MUTABLE_OBJECT_CACHE_CONTROL|["']3600["'])/;

/** The text of the call starting at `open` (the `(`), through its matching `)`. */
function callText(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

function sites() {
  const files = walkSource(["src", "supabase/functions"].map((d) => resolve(ROOT, d)))
    .filter((f) => !/\.test\.tsx?$/.test(f) && !f.includes("/src/test/"));
  const out: { id: string; call: string }[] = [];
  for (const f of files) {
    const src = blankComments(readFileSync(f, "utf8"));
    let n = 0;
    for (let i = src.indexOf(".upload("); i !== -1; i = src.indexOf(".upload(", i + 1)) {
      out.push({ id: `${relative(ROOT, f)}#${n++}`, call: callText(src, i + ".upload".length) });
    }
  }
  return out;
}

describe("storage uploads set cacheControl (Q655)", () => {
  const all = sites();

  it("finds the upload sites", () => {
    // 20 measured on 2026-09-27; far fewer means the scan broke.
    expect(all.length).toBeGreaterThan(18);
  });

  it("every upload passes a year or an hour", () => {
    const bad = all.filter((s) => !YEAR.test(s.call) && !HOUR.test(s.call)).map((s) => s.id);
    expect(bad, "storage .upload( without cacheControl (storage-js defaults to an hour)").toEqual([]);
  });

  it("every upsert is classified, both lists exact", () => {
    const upserts = all.filter((s) => /upsert\s*:\s*true/.test(s.call)).map((s) => s.id).sort();
    expect(upserts).toEqual([...MUTABLE_KEY_UPLOADS, ...UPSERT_BUT_VERSIONED].sort());
  });

  it("only mutable-key uploads keep an hour; everything else caches a year", () => {
    const wrong = all
      .filter((s) => (MUTABLE_KEY_UPLOADS.includes(s.id) ? !HOUR.test(s.call) : !YEAR.test(s.call)))
      .map((s) => s.id);
    expect(wrong).toEqual([]);
  });
});
