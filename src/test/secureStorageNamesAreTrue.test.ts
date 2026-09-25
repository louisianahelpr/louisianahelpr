/**
 * CLASS GUARD (OA-004): a name that claims a secure store must use one.
 *
 * THE BUG: the native Supabase session adapter was called
 * `keychainStorageAdapter` (file, export and call site in client.ts) while it
 * writes through @capacitor/preferences, which is NSUserDefaults: an
 * unencrypted plist, included in device backups, not passcode-gated. The name
 * asserted a security property the code does not have, which is exactly what
 * stopped anyone noticing (the token was later seen in plaintext in
 * com.Helpr.plist on a simulator). It is now `preferencesStorageAdapter`.
 *
 * THE CLASS, from the source tree: every src/ file (tests excluded) whose
 * path, or whose CODE (comments and strings blanked), names a Keychain /
 * secure / encrypted store must import a module that provides one (a module
 * specifier matching SECURE_MODULE). A comment may still talk about the
 * Keychain; an identifier or file name may not claim it falsely.
 *
 * @mutate src/integrations/supabase/preferencesStorageAdapter.ts | export const preferencesStorageAdapter = { | export const keychainStorageAdapter = {
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blankNonCode } from "./helpers/blankNonCode";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

/** Words that claim a secure store, in a file path or an identifier. */
const CLAIM = /keychain|secure_?storage|secure_?store|encrypted_?storage|encrypted_?store/i;
/** Module specifiers that really provide one. */
const SECURE_MODULE = /keychain|secure-?storage|secure-?store|capacitor-secure/i;
const IMPORT = /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "test" ? [] : walk(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

const files = walk(SRC);

const offenders = files
  .map((p) => {
    const text = readFileSync(p, "utf8");
    const rel = relative(ROOT, p);
    const claims = CLAIM.test(rel) || CLAIM.test(blankNonCode(text));
    if (!claims) return null;
    const specs = [...text.matchAll(IMPORT)].map((m) => m[1] ?? m[2]);
    return specs.some((s) => SECURE_MODULE.test(s)) ? null : rel;
  })
  .filter((x): x is string => x !== null);

describe("names that claim a secure store use one (OA-004)", () => {
  it("scans the source tree (floor)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.endsWith("integrations/supabase/preferencesStorageAdapter.ts"))).toBe(true);
  });

  it("no file or identifier claims Keychain/secure storage without importing it", () => {
    expect(offenders).toEqual([]);
  });

  it("the check sees an identifier claim (self-test)", () => {
    expect(CLAIM.test(blankNonCode("export const keychainStorageAdapter = {};"))).toBe(true);
    expect(CLAIM.test(blankNonCode("// the iOS Keychain is not used here\nconst x = 1;"))).toBe(false);
  });
});
