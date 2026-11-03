// No HEIC photo can reach the Declutter photo check, so the check needs no HEIC conversion.
//
// The check sweep (supabase/functions/declutter-ai-draft/index.ts, sweepJudge) sends each listing photo's own bytes to
// the model, which reads JPEG, PNG, GIF and WebP only. It used to ask Storage's image transform for a rendered copy of
// anything else (an iPhone HEIC); B56 measured on prod (10-31, read-only) that no HEIC can get there, and B61 removed
// that dead branch (11-01). This guard keeps the two layers that make it dead:
//   1. the job-photos bucket's allowed_mime_types (the newest migration that sets it) has no image/heic or image/heif;
//   2. the newest declutter_add_item_photo accepts only JPEG, PNG or WebP storage objects.
// If either ever lets HEIC in, this goes red: put a conversion back into sweepJudge before widening them.
//
// @mutate supabase/migrations/20260915055517_storage_bucket_limits.sql | 'image/jpeg', 'image/png', 'image/webp', 'image/gif', | 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
// @mutate supabase/migrations/20261103055505_declutter_shops_homes_messages_not_found_is_404.sql | IS DISTINCT FROM p_item_id::text\n     OR NOT EXISTS (\n       SELECT 1 FROM storage.objects o\n        WHERE o.bucket_id = 'job-photos'\n          AND o.name = p_storage_path\n          AND (o.owner_id = v_uid::text OR o.owner = v_uid)\n          -- Images only: job-photos also takes video, and a video keeps its\n          -- GPS atoms (the app's re-encode strips images only).\n          AND o.metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp') | IS DISTINCT FROM p_item_id::text\n     OR NOT EXISTS (\n       SELECT 1 FROM storage.objects o\n        WHERE o.bucket_id = 'job-photos'\n          AND o.name = p_storage_path\n          AND (o.owner_id = v_uid::text OR o.owner = v_uid)\n          -- Images only: job-photos also takes video, and a video keeps its\n          -- GPS atoms (the app's re-encode strips images only).\n          AND o.metadata ->> 'mimetype' IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic')
import { describe, it, expect } from "vitest";
import { computeState } from "./storageBucketLimits.test";
import { newestFunction } from "./helpers/parityReaders";

const READABLE = ["image/jpeg", "image/png", "image/webp", "image/gif"];

describe("no HEIC photo reaches the Declutter photo check", () => {
  it("the job-photos bucket takes no HEIC", () => {
    const mime = computeState().get("job-photos")?.mime ?? [];
    expect(mime.length).toBeGreaterThan(3);
    const images = mime.filter((m) => m.startsWith("image/"));
    expect(images.filter((m) => !READABLE.includes(m)), "image types the model cannot read").toEqual([]);
  });

  it("declutter_add_item_photo accepts only JPEG, PNG or WebP objects", () => {
    const body = newestFunction("declutter_add_item_photo").body;
    const m = /metadata\s*->>\s*'mimetype'\s+IN\s*\(([^)]*)\)/.exec(body);
    expect(m, "the RPC's mimetype check").not.toBeNull();
    const types = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(types.length).toBeGreaterThan(0);
    expect(types.filter((t) => !READABLE.includes(t))).toEqual([]);
  });
});
