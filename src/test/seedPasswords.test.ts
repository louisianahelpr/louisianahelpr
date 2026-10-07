// @mutate scripts/audit/seedPasswords.mjs | if (secret && creating) { | if (false) {
/**
 * prod-seed --apply must never (re)create a seed account that CI signs in by
 * password without setting that password (#1582: helpr-seed-incomplete-0912
 * was re-created on 2026-10-01 with none, and every press-every-control leg
 * failed invalid_credentials for it).
 *
 * The CI-password set is derived from the world, not trusted: every
 * `secrets.PLAYWRIGHT_<KEY>_PASSWORD` a workflow reads whose <KEY> is an
 * account prod-seed.mjs OWNS must be in CI_PASSWORD_ACCOUNTS, and nothing else.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
// @ts-expect-error - plain .mjs script module, no types
import { CI_PASSWORD_ACCOUNTS, seedPasswordFor } from "../../scripts/audit/seedPasswords.mjs";

const ROOT = path.resolve(__dirname, "../..");
const seedSrc = fs.readFileSync(path.join(ROOT, "scripts/audit/prod-seed.mjs"), "utf8");

function ownedKeys(): string[] {
  const block = seedSrc.slice(seedSrc.indexOf("const OWNED = {"));
  const body = block.slice(0, block.indexOf("\n};"));
  return [...body.matchAll(/^\s{2}(\w+): \{ email: "/gm)].map((m) => m[1]);
}

function workflowPasswordSecrets(): Set<string> {
  const dir = path.join(ROOT, ".github/workflows");
  const out = new Set<string>();
  for (const f of fs.readdirSync(dir)) {
    if (!/\.ya?ml$/.test(f)) continue;
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of src.matchAll(/secrets\.(PLAYWRIGHT_([A-Z0-9_]+)_PASSWORD)\b/g)) out.add(m[1]);
  }
  return out;
}

describe("prod-seed CI-password accounts", () => {
  it("parses the OWNED accounts out of prod-seed.mjs", () => {
    const keys = ownedKeys();
    expect(keys).toContain("incomplete");
    expect(keys).toContain("admin");
  });

  it("CI_PASSWORD_ACCOUNTS is exactly the owned accounts a workflow signs in by password", () => {
    const owned = new Set(ownedKeys());
    const secrets = workflowPasswordSecrets();
    // 4 PLAYWRIGHT_*_PASSWORD secrets across the workflows (measured 2026-10-07:
    // PLAYWRIGHT_TEST_USER_PASSWORD left e2e-real-backend with Q1420's minted grant).
    expect(secrets.size).toBeGreaterThanOrEqual(4);
    const fromWorkflows: Record<string, string> = {};
    for (const secret of secrets) {
      const key = secret.replace(/^PLAYWRIGHT_/, "").replace(/_PASSWORD$/, "").toLowerCase();
      if (owned.has(key)) fromWorkflows[key] = secret;
    }
    expect({ ...CI_PASSWORD_ACCOUNTS }).toEqual(fromWorkflows);
  });

  it("refuses to create a CI-password account whose SEED_PASSWORD_<KEY> is unset", () => {
    expect(Object.keys(CI_PASSWORD_ACCOUNTS).length).toBeGreaterThan(0);
    for (const key of Object.keys(CI_PASSWORD_ACCOUNTS)) {
      expect(() => seedPasswordFor(key, {}, { creating: true })).toThrow(/REFUSED: SEED_PASSWORD_/);
      // An existing account is kept as is: prod-audit's CI --apply has no SEED_PASSWORD_*.
      expect(seedPasswordFor(key, {})).toBeNull();
      expect(seedPasswordFor(key, { [`SEED_PASSWORD_${key.toUpperCase()}`]: "x".repeat(16) })).toBe("x".repeat(16));
    }
  });

  it("leaves accounts CI never signs in by password alone", () => {
    expect(seedPasswordFor("banned", {})).toBeNull();
  });

  it("prod-seed resolves the password before it creates the auth user", () => {
    const fn = seedSrc.slice(seedSrc.indexOf("async function ensureOwnedAccount("));
    const resolve = fn.indexOf("seedPasswordFor(key,");
    const create = fn.indexOf("/auth/v1/admin/users`");
    expect(resolve).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(resolve);
    expect(fn.slice(0, fn.indexOf("\n}\n"))).not.toMatch(/process\.env\[`SEED_PASSWORD_/);
  });
});
