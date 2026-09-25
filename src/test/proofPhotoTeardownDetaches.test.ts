// @mutate e2e/prod-lifecycle.spec.ts |         data: { prefixes: detached }, |         data: { prefixes: paths },
// @mutate e2e/proofPhotoTeardown.ts |   return paths.some((p) => named.has(p)); |   return false;
/**
 * CLASS GUARD: a test teardown never deletes a proof photo that a surviving job
 * row still names.
 *
 * press-every-control run 36069319716 failed four presses on /posts with
 *   400 POST d21a09ef-…/after-1790177377210-qb77x2ehqaa.png
 *   400 POST 4a980ec0-…/before-1790251764067-3ap1gje8ekw.png | …/after-…
 * (storage's answer to signing an object it does not have). Measured on prod
 * 2026-09-25: 6 jobs named a missing proof object, all is_seed, 5 of them
 * "[E2E DO NOT ACCEPT] automated lifecycle" jobs, and none has any object left
 * in its folder. The writer: prod-lifecycle.spec.ts's afterEach removed the
 * objects it uploaded and left the funded row (which cannot be deleted)
 * pointing at them.
 *
 * Inventory: every DELETE against /storage/v1/object/proof-photos in e2e/ and
 * scripts/. Each must delete only the paths its detach loop confirmed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { walkSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";
import { pathsByJob, rowStillNames, withoutPaths } from "../../e2e/proofPhotoTeardown";

const ROOT = resolve(__dirname, "..", "..");

describe("proof photo teardown detaches the row first", () => {
  it("withoutPaths drops only this run's paths, rowStillNames sees what remains", () => {
    const row = { id: "j", proof_before_urls: ["j/before-1.png", "j/keep.png"], proof_after_urls: ["j/after-1.png"] };
    const patch = withoutPaths(row, ["j/before-1.png", "j/after-1.png"]);
    expect(patch).toEqual({ proof_before_urls: ["j/keep.png"], proof_after_urls: [] });
    expect(rowStillNames(row, ["j/after-1.png"])).toBe(true);
    expect(rowStillNames({ ...row, ...patch }, ["j/before-1.png", "j/after-1.png"])).toBe(false);
    expect(rowStillNames({ id: "j", proof_before_urls: null, proof_after_urls: null }, ["j/x.png"])).toBe(false);
    expect([...pathsByJob(["a/1.png", "b/2.png", "a/3.png"])]).toEqual([["a", ["a/1.png", "a/3.png"]], ["b", ["b/2.png"]]]);
  });

  it("every proof-photos object DELETE deletes only the detached paths", () => {
    const files = walkSource([resolve(ROOT, "e2e"), resolve(ROOT, "scripts")], [".ts", ".mjs"]);
    expect(files.length).toBeGreaterThan(100);
    const sites: string[] = [];
    const bad: string[] = [];
    for (const f of files) {
      const src = blankComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/\.delete\(\s*`[^`]*\/storage\/v1\/object\/proof-photos`[\s\S]{0,200}?prefixes:\s*(\w+)/g)) {
        sites.push(f);
        const before = src.slice(0, m.index);
        if (m[1] !== "detached" || !/rowStillNames\(/.test(before) || !/withoutPaths\(/.test(before)) bad.push(`${f}: deletes ${m[1]}`);
      }
    }
    expect(sites.length).toBeGreaterThanOrEqual(1);
    expect(bad).toEqual([]);
  });
});
