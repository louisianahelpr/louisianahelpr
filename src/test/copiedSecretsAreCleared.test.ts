/**
 * OA-015: the TOTP setup key is a permanent credential, and copying it is the
 * main 2FA enrolment path. Any file that puts a secret on the clipboard must
 * also overwrite it, and TwoFactorCard must do so on both Verify and Cancel.
 * Inventory: every non-test source file under src/.
 *
 * @mutate src/components/profile/TwoFactorCard.tsx | 6) return;\n    clearCopiedSecret(); | 6) return;
 * @mutate src/components/profile/TwoFactorCard.tsx | <DialogSecondaryAction onClick={close}> | <DialogSecondaryAction onClick={onClose}>
 * @mutate src/components/profile/TwoFactorCard.tsx | navigator.clipboard?.writeText("") | Promise.resolve()
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

const files = walk("src");
const copiesSecret = files.filter((f) =>
  /clipboard\??\.writeText\([^)]*secret/i.test(readFileSync(f, "utf8")),
);

describe("copied secrets are cleared (OA-015)", () => {
  it("the inventory is real", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(copiesSecret).toContain("src/components/profile/TwoFactorCard.tsx");
  });

  it("every file that copies a secret also overwrites the clipboard", () => {
    const missing = copiesSecret.filter(
      (f) => !/clipboard\??\.writeText\(""\)/.test(readFileSync(f, "utf8")),
    );
    expect(missing).toEqual([]);
  });

  it("TwoFactorCard clears it on Verify (before the await) and on Cancel", () => {
    const src = readFileSync("src/components/profile/TwoFactorCard.tsx", "utf8");
    const verify = src.slice(src.indexOf("const handleVerify"), src.indexOf("await supabase.auth.mfa.challengeAndVerify"));
    expect(verify).toContain("clearCopiedSecret();");
    expect(src).toContain("<DialogSecondaryAction onClick={close}>");
    expect(src).toContain("if (!o) close();");
  });
});
