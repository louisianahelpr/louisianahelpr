// The live-AASA probe (e2e/happy-path/zz-runtime-probe.spec.ts, "3a") pins a
// hand list of claims and exclusions against the SERVED file. When Q194
// deliberately removed the short-link claims from the committed file, that list
// still required /j/*, and the probe went red only in Playwright against prod
// (measured on the refresh bot PR, run 35951252686, 2026-09-24). Every entry the
// probe pins must exist in the committed file, so a stale copy fails here, on
// main, beside the change that made it stale.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SPEC = readFileSync(join(ROOT, "e2e", "happy-path", "zz-runtime-probe.spec.ts"), "utf8");
const AASA = JSON.parse(readFileSync(join(ROOT, "public", ".well-known", "apple-app-site-association"), "utf8"));
const committed: string[] = AASA.applinks.details[0].paths;

function listLiteral(name: string): string[] {
  const m = SPEC.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
}

describe("live-AASA probe pins only committed entries", () => {
  const pinned = [...listLiteral("REQUIRED_CLAIMS"), ...listLiteral("REQUIRED_EXCLUSIONS")];
  it("finds the probe lists and the committed paths (floors 2026-09-24: 10 pinned, 20 paths)", () => {
    expect(pinned.length).toBeGreaterThanOrEqual(10);
    expect(committed.length).toBeGreaterThanOrEqual(20);
  });
  it("every pinned entry is in public/.well-known/apple-app-site-association", () => {
    expect(pinned.filter((p) => !committed.includes(p))).toEqual([]);
  });
});

// @mutate e2e/happy-path/zz-runtime-probe.spec.ts | "/jobs/*", "/user/*", | "/jobs/*", "/j/*", "/user/*",
