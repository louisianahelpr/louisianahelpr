// @mutate supabase/migrations/20261031152545_declutter_check_after_post.sql |   IF v_photos < 1 OR v_photos > 12 THEN |   IF v_photos < 3 OR v_photos > 12 THEN
// @mutate src/lib/declutter/photoRules.ts | export const DECLUTTER_MIN_PHOTOS = 1; | export const DECLUTTER_MIN_PHOTOS = 3;
// @mutate src/components/declutter/DeclutterSellView.tsx | photoCount >= DECLUTTER_MIN_PHOTOS && ( | photoCount >= 3 && (
//
// Owner decision 2026-10-20 (pop-up on the Cowork design audit): ONE photo is
// enough to list on Declutter (it was 3). The minimum lived in five places:
// the server's declutter_publish_item, the sell form's counter, its "List it"
// gate, the moving-out batch, and the error copy. The class: the app's number
// is ONE constant (src/lib/declutter/photoRules.ts) equal to the server's
// newest definition, every Declutter screen reads it (no literal photo count
// in a Declutter component), and the refusal copy says the same number.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { DECLUTTER_MAX_PHOTOS, DECLUTTER_MIN_PHOTOS } from "@/lib/declutter/photoRules";

const ROOT = resolve(__dirname, "../..");
const DEFS = effectiveDefs(resolve(ROOT, "supabase/migrations"));
const DIR = resolve(ROOT, "src/components/declutter");

describe("Declutter photo minimum: one number, app and server", () => {
  it("the server's newest declutter_publish_item asks for the app's minimum and maximum", () => {
    const body = blankSqlComments(DEFS.get("declutter_publish_item")?.stmt ?? "");
    const m = /IF v_photos < (\d+) OR v_photos > (\d+) THEN\s+RAISE EXCEPTION 'photos_required'/.exec(body);
    expect(m, "declutter_publish_item no longer refuses photos_required by count").not.toBeNull();
    expect(Number(m![1])).toBe(DECLUTTER_MIN_PHOTOS);
    expect(Number(m![2])).toBe(DECLUTTER_MAX_PHOTOS);
    expect(DECLUTTER_MIN_PHOTOS).toBe(1); // owner, 2026-10-20
  });

  it("the refusal copy says the same number", async () => {
    const { DECLUTTER_ERROR_COPY } = (await import("@/lib/declutter/errors")) as unknown as { DECLUTTER_ERROR_COPY?: Record<string, string> };
    const src = readFileSync(resolve(ROOT, "src/lib/declutter/errors.ts"), "utf8");
    const line = /photos_required:\s*"([^"]+)"/.exec(src)?.[1] ?? DECLUTTER_ERROR_COPY?.photos_required ?? "";
    expect(line).toMatch(new RegExp(`at least ${DECLUTTER_MIN_PHOTOS} photo${DECLUTTER_MIN_PHOTOS === 1 ? "\\b" : "s"}`));
    expect(line).toContain(`up to ${DECLUTTER_MAX_PHOTOS}`);
  });

  it("inventory: no Declutter component compares a photo count to a literal number", () => {
    const files = readdirSync(DIR).filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f));
    expect(files.length).toBeGreaterThan(20);
    const offenders: string[] = [];
    for (const f of files) {
      const src = blankComments(readFileSync(join(DIR, f), "utf8"));
      for (const m of src.matchAll(/\b(photoCount|count|n)\s*(?:>=|<|>|<=)\s*(\d+)\b|of \d+ photos|at least \d+ photos/g)) {
        // `n` is also the strikes count in StrikeCount; only lines about photos count.
        const line = src.slice(src.lastIndexOf("\n", m.index!) + 1, src.indexOf("\n", m.index!));
        // "> 0" (any photo at all, e.g. the AI draft) is not a minimum.
        if (m[2] === "0") continue;
        if (/photo|isDraft/i.test(line)) offenders.push(`${f}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
