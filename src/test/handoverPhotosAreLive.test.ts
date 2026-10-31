/**
 * Anti-lying #2, "Live camera only" (owner 2026-10-28, ~/.lh-wt/declutter-next-queue-1028.md item 2): every Declutter
 * handover photo comes from the camera at that moment.
 *
 * Server: the class is built from the migrations' own inventory (the EFFECTIVE definition of every function that takes
 * a p_photo_path and checks it as a handover photo: an object in the 'declutter-handover' bucket, or
 * helpr_task_photo_ok), as src/test/handoverPhotosAtTheAddress.test.ts builds it. Each must refuse a stale upload
 * with photo_too_old: by calling handover_photo_is_fresh itself, or through helpr_task_photo_ok, which must. The
 * freshness is the storage server's own upload time (storage.objects.created_at), 10 minutes, and no member may call
 * the check directly.
 * Device: every handover photo input opens the camera (capture="environment"), and both handover upload paths check
 * the file's own time first (assertLivePhoto, src/lib/declutter/livePhoto.ts).
 * Backend proof: src/test/pglite/declutterHandoverPhotosLive.pglite.mjs (3x; RED without it and on 9 plants).
 */
// @mutate supabase/migrations/20261029002010_declutter_handover_photos_live_only.sql |   SELECT COALESCE((SELECT so.created_at > now() - interval '10 minutes' |   SELECT COALESCE((SELECT so.created_at > now() - interval '1 day'
// @mutate supabase/migrations/20261029002010_declutter_handover_photos_live_only.sql |   IF NOT public.handover_photo_is_fresh('helpr-tasks', p_path) THEN |   IF false THEN
// @mutate supabase/migrations/20261030164712_declutter_porch_places.sql | so.name = p_photo_path) THEN\n    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';\n  END IF;\n  -- Live camera only (20261029002010): uploaded in the last 10 minutes, by the storage server's own clock.\n  IF NOT public.handover_photo_is_fresh('declutter-handover', p_photo_path) THEN | so.name = p_photo_path) THEN\n    RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = '22023';\n  END IF;\n  IF false THEN
// @mutate src/lib/declutter/handover.ts |   assertLivePhoto(file);\n  const cleaned |   const cleaned
// @mutate src/lib/helprTasks/api.ts |   assertLivePhoto(file);\n  return uploadCleaned(`${userId}/task/ |   return uploadCleaned(`${userId}/task/
// @mutate src/components/ui/PhotoPickButton.tsx |         capture="environment"\n |
// @mutate src/lib/declutter/livePhoto.ts | now - file.lastModified > LIVE_PHOTO_MAX_AGE_MS | now - file.lastModified > 10 * LIVE_PHOTO_MAX_AGE_MS
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { assertLivePhoto, LIVE_PHOTO_MAX_AGE_MS } from "@/lib/declutter/livePhoto";

const ROOT = resolve(__dirname, "../..");
const DEFS = effectiveDefs(resolve(ROOT, "supabase/migrations"));
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const src = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

// The same reasoned exclusions as the at-the-address guard: not a handover photo.
const NOT_A_HANDOVER = new Set(["declutter_report_problem", "declutter_handover_photo_access", "helpr_task_photo_ok"]);
const TOO_OLD = "RAISE EXCEPTION 'photo_too_old'";

function inventory(): string[] {
  const out: string[] = [];
  for (const [name, d] of DEFS) {
    const head = d.stmt.slice(0, d.stmt.search(/\bAS\s+\$/i));
    const body = flat(d.stmt);
    if (!/\bp_photo_path\b/.test(head)) continue;
    if (!/'declutter-handover'|helpr_task_photo_ok\(/.test(body)) continue;
    if (!NOT_A_HANDOVER.has(name)) out.push(name);
  }
  return out.sort();
}

describe("every Declutter handover photo is live (camera at that moment, server's clock)", () => {
  const inv = inventory();

  it("reads the handover photo RPCs (floor)", () => {
    expect(inv.length).toBeGreaterThan(5);
  });

  it("the freshness check is the storage server's upload time, 10 minutes, and members cannot call it", () => {
    const fresh = flat(DEFS.get("handover_photo_is_fresh")?.stmt ?? "");
    expect(fresh).toContain("so.created_at > now() - interval '10 minutes'");
    expect(fresh).toContain("FROM storage.objects so WHERE so.bucket_id = p_bucket AND so.name = p_path");
    // The grant sits beside the check's NEWEST definition (whichever migration that is).
    const freshFile = DEFS.get("handover_photo_is_fresh")?.file ?? "";
    expect(freshFile).not.toBe("");
    const mig = blankSqlComments(readFileSync(resolve(ROOT, "supabase/migrations", freshFile), "utf8"));
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.handover_photo_is_fresh(text, text) FROM PUBLIC, anon, authenticated;");
  });

  it("the Helpr's photo check refuses a stale task photo", () => {
    const ok = flat(DEFS.get("helpr_task_photo_ok")?.stmt ?? "");
    expect(ok).toContain(`IF NOT public.handover_photo_is_fresh('helpr-tasks', p_path) THEN ${TOO_OLD}`);
  });

  it("every handover photo RPC refuses a stale upload with photo_too_old", () => {
    const missing = inv.filter((name) => {
      const body = flat(DEFS.get(name)?.stmt ?? "");
      const own = body.includes(`IF NOT public.handover_photo_is_fresh('declutter-handover', p_photo_path) THEN ${TOO_OLD}`);
      return !own && !body.includes("public.helpr_task_photo_ok(");
    });
    expect(missing).toEqual([]);
  });

  it("the device: every handover photo input opens the camera, and both upload paths check the file's time", () => {
    for (const f of ["src/components/ui/PhotoPickButton.tsx", "src/components/declutter/DeclutterHandoverViews.tsx"]) {
      const s = src(f);
      const inputs = [...s.matchAll(/<input\b[^>]*type="file"[^>]*>/g)].map((m) => m[0]);
      expect(inputs.length, f).toBeGreaterThan(0);
      for (const i of inputs) expect(i, f).toContain('capture="environment"');
    }
    expect(src("src/lib/declutter/handover.ts")).toMatch(/uploadHandoverPhoto[\s\S]{0,400}assertLivePhoto\(file\);/);
    expect(src("src/lib/helprTasks/api.ts")).toMatch(/uploadTaskPhoto[\s\S]{0,400}assertLivePhoto\(file\);/);
  });

  it("assertLivePhoto refuses a file older than 10 minutes, and passes a fresh one or one with no time", () => {
    const now = 1_800_000_000_000;
    const file = (ago: number) => new File(["x"], "p.jpg", { type: "image/jpeg", lastModified: now - ago });
    expect(() => assertLivePhoto(file(LIVE_PHOTO_MAX_AGE_MS + 1000), now)).toThrow("photo_too_old");
    expect(() => assertLivePhoto(file(60_000), now)).not.toThrow();
    expect(() => assertLivePhoto(new File(["x"], "p.jpg", { type: "image/jpeg", lastModified: 0 }), now)).not.toThrow();
    expect(LIVE_PHOTO_MAX_AGE_MS).toBe(10 * 60_000);
  });
});
