/**
 * Every prod-audit WRITE FIREWALL lets a Storage sign request through.
 *
 * `createSignedUrl` is a POST that only mints a read link. On 2026-09-24 the
 * admin-views firewall was taught that, the messy-input one (harness.ts
 * `writeFirewall`) was not, and run 35987833531 filed /admin?view=credentials'
 * "Couldn't load preview" as a "section/data load failure" 8 times — a
 * healthy screen the harness itself broke. The class: a firewall added or
 * edited without the shared `isStorageSignPath` rule.
 *
 * @mutate e2e/prod-audit/harness.ts | (isReadRpcPath(pathname) \|\| isStorageSignPath(pathname)) | isReadRpcPath(pathname)
 * @mutate e2e/prod-audit/admin-views.spec.ts | const READ_STORAGE = { test: (url: string) => isStorageSignPath(new URL(url).pathname) }; | const READ_STORAGE = { test: (_url: string) => false };
 * @mutate e2e/readRpc.ts | return /^\/storage\/v1\/object\/sign\//.test(pathname); | return /^\/storage\/v1\/object\//.test(pathname);
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isStorageSignPath } from "../../e2e/readRpc";

const ROOT = resolve(__dirname, "../..");
const DIR = join(ROOT, "e2e/prod-audit");

describe("prod-audit write firewalls pass Storage sign requests", () => {
  it("isStorageSignPath passes signing and refuses uploads", () => {
    expect(isStorageSignPath("/storage/v1/object/sign/user-documents/u/credentials/x.png")).toBe(true);
    expect(isStorageSignPath("/storage/v1/object/user-documents/u/credentials/x.png")).toBe(false);
    expect(isStorageSignPath("/storage/v1/object/avatars/u/a.png")).toBe(false);
  });

  it("every file that aborts Supabase writes also consults isStorageSignPath", () => {
    const firewalls = readdirSync(DIR)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => ({ f, src: readFileSync(join(DIR, f), "utf8") }))
      // A write firewall: routes all of Supabase and aborts what it refuses.
      .filter(({ src }) => /route\(`\$\{SUPABASE_URL\}\/\*\*`/.test(src) && /route\.abort\("blockedbyclient"\)/.test(src));
    expect(firewalls.length).toBeGreaterThan(0);
    for (const { f, src } of firewalls) {
      expect(src, `${f} has a write firewall that does not pass Storage sign`).toMatch(/isStorageSignPath\(/);
    }
  });

  it("the harness firewall passes sign POSTs alongside read RPCs", () => {
    const src = readFileSync(join(DIR, "harness.ts"), "utf8");
    expect(src).toMatch(/isReadRpcPath\(pathname\) \|\| isStorageSignPath\(pathname\)/);
  });
});
