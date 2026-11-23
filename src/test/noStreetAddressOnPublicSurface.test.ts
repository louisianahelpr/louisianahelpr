// Owner 11-23: "Remove my address" - her street address must not show on the public website.
// @mutate src/content/sponsorPage.ts | We'll send you our address. | 314 Lynn Street, Delcambre, LA 70528.
// Emails are out of scope on purpose: the CAN-SPAM postal footer (_shared/resend.ts) and the sponsor ship-to
// email (sponsorDelivery.ts) must carry an address; they are listed in ALLOWED and need the owner's call.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();
const DIRS = ["src/content", "src/components", "src/pages", "public", "supabase/functions"];
// @two-way src/test/noStreetAddressOnPublicSurface.test.ts:stale allowlist entry
const ALLOWED = new Set([
  "supabase/functions/_shared/resend.ts",
  "supabase/functions/_shared/email-templates/sponsorDelivery.ts",
]);
const TEXT = /\.(tsx?|mjs|js|json|html|xml|txt|md|svg|webmanifest)$/;
const IS_TEST = /(\.test\.|\.spec\.|\/__tests__\/|\/test\/|fixtures?\/)/;
const ADDR = /Lynn St(reet)?\b|314 Lynn/i;

function walk(d: string, out: string[]) {
  for (const n of readdirSync(join(ROOT, d))) {
    const rel = `${d}/${n}`;
    if (n === "node_modules") continue;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (TEXT.test(n) && !IS_TEST.test(`/${rel}`)) out.push(rel);
  }
}

describe("no street address on the public surface", () => {
  it("no non-test file shows the owner's street address", () => {
    const files: string[] = [];
    for (const d of DIRS) walk(d, files);
    expect(files.length).toBeGreaterThan(300);
    const hits = files.filter((f) => !ALLOWED.has(f) && ADDR.test(/\.(tsx?|mjs|js)$/.test(f) ? blankComments(readFileSync(join(ROOT, f), "utf8")) : readFileSync(join(ROOT, f), "utf8")));
    expect(hits).toEqual([]);
  });

  it("every ALLOWED file still carries the address in code (else remove it)", () => {
    const stale = [...ALLOWED].filter((f) => !ADDR.test(blankComments(readFileSync(join(ROOT, f), "utf8"))));
    expect(stale, stale.map((f) => `stale allowlist entry ${f} — remove it`).join("\n")).toEqual([]);
  });
});
