// @mutate e2e/prod-lifecycle.spec.ts | const signed = await request.post(`${SUPABASE_URL}/storage/v1/object/sign/proof-photos/${path}`, { | const signed = await request.post(`${SUPABASE_URL}/storage/v1/object/public/proof-photos/${path}`, {
// @mutate e2e/prod-lifecycle.spec.ts | expect(beforeUrl, "the row must store the before photo's storage path").toBe(beforePath); | expect(beforeUrl, "the row must store the before photo's storage path").toContain(beforePath);
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Since 65676a7ad (2026-09-22) jobs.proof_before_urls / proof_after_urls hold
 * the storage PATH and the app mints a ten-minute signed link at display time.
 * prod-lifecycle kept fetching the stored value as if it were a URL: the bare
 * path resolved against the web app and measured index.html (34846 bytes vs a
 * 70-byte upload), and the money journey went red on 2026-09-24. Class: every
 * e2e spec that reads a proof photo's bytes signs the path first, and pins the
 * stored value as a path (a full URL there is the expiring-JWT regression).
 */
const ROOT = resolve(__dirname, "..", "..");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(n) ? [p] : [];
  });
}
const specs = walk(join(ROOT, "e2e"))
  .map((f) => ({ f: f.slice(ROOT.length + 1), src: readFileSync(f, "utf8") }))
  .filter(({ src }) => /proof_(before|after)_urls/.test(src) && /\.body\(\)/.test(src));

describe("e2e proof-photo byte checks go through a signed link", () => {
  it("finds the specs that fetch proof-photo bytes", () => {
    expect(specs.map((s) => s.f)).toContain("e2e/prod-lifecycle.spec.ts");
  });

  it.each(specs.map((s) => [s.f, s.src]))("%s signs the stored path and pins it as a path", (_f, src) => {
    expect(src).toMatch(/\/storage\/v1\/object\/sign\/proof-photos\//);
    expect(src).toMatch(/"the row must store the before photo's storage path"\)\.toBe\(beforePath\)/);
  });
});
