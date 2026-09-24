/**
 * BR-021: public/ IS the web origin — every file in it is deployed and, via
 * `cap copy`, bundled into the native app too. The 1.3 MB of 1024px iOS icon
 * sources sat there for months because check-asset-weight.mjs only caps NEW
 * or MODIFIED files and allowlisted them. They now live in branding/. This
 * pins the whole class: every file under public/ is within the 300 KB cap or
 * named in that script's ALLOWLIST with a reason.
 *
 * @mutate scripts/check-asset-weight.mjs |   ["public/helpr-splash-icon.png", "338KB, shipped splash icon — compression candidate, needs a visual check first"], |   // dropped
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const CAP = 300 * 1024;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

describe("public/ ships nothing over the asset cap unless allowlisted (BR-021)", () => {
  const files = walk(join(ROOT, "public")).map((f) => relative(ROOT, f));
  const allow = new Set(
    [...readFileSync(join(ROOT, "scripts/check-asset-weight.mjs"), "utf8").matchAll(/^\s*\["(public\/[^"]+)",/gm)].map((m) => m[1]),
  );

  it("inventory is real", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("every oversized public file is allowlisted", () => {
    const over = files.filter((f) => statSync(join(ROOT, f)).size > CAP && !allow.has(f));
    expect(over).toEqual([]);
  });
});
