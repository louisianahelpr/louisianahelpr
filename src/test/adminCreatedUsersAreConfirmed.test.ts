/*
 * Q192(b) (2026-09-26): email confirmation is enforced ONLY by GoTrue refusing
 * a session to an unconfirmed account; no RLS policy or RPC reads
 * email_verified. The one way our own code could mint a session for an
 * unconfirmed account is the admin API creating a user without
 * `email_confirm: true`. Measured on prod the same day: 0 auth.users with
 * email_confirmed_at NULL, so 0 unconfirmed accounts with any job, message or
 * application.
 *
 * This pins the half we control: every admin user-creation call in the repo
 * (POST …/auth/v1/admin/users, or supabase-js auth.admin.createUser) passes
 * `email_confirm: true` in its body. Inventory from source, with a floor.
 */
// @mutate scripts/audit/prod-seed.mjs | body: JSON.stringify({ email: spec.email, email_confirm: true, | body: JSON.stringify({ email: spec.email,
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const ROOTS = ["src", "supabase/functions", "scripts", "e2e"];
const SKIP_DIRS = new Set(["node_modules", "fixtures", "dist"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(e)) out.push(...walk(p));
    } else if (/\.(ts|tsx|mjs|js)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

// A POST to the admin users endpoint (not a GET/PUT on one user), or createUser.
const SITE = /\/auth\/v1\/admin\/users[`"'][\s\S]{0,40}?method:\s*["']POST["']|request\.post\(\s*`[^`]*\/auth\/v1\/admin\/users`|auth\.admin\.createUser\s*\(/g;

function sites(): { file: string; line: number; window: string }[] {
  const out: { file: string; line: number; window: string }[] = [];
  for (const root of ROOTS) {
    for (const f of walk(join(REPO, root))) {
      const code = blankComments(readFileSync(f, "utf8"));
      for (const m of code.matchAll(SITE)) {
        out.push({
          file: relative(REPO, f),
          line: code.slice(0, m.index).split("\n").length,
          window: code.slice(m.index!, m.index! + 400),
        });
      }
    }
  }
  return out;
}

describe("admin-created users are created confirmed (Q192b)", () => {
  it("every admin user-creation call passes email_confirm: true", () => {
    const bad = sites()
      .filter((s) => !/email_confirm:\s*true/.test(s.window))
      .map((s) => `${s.file}:${s.line}`);
    expect(bad, "an admin-created user without email_confirm: true could hold a session nothing server-side checks").toEqual([]);
  });

  it("the inventory is real (floor)", () => {
    const found = sites();
    expect(found.length).toBeGreaterThanOrEqual(4);
    expect(found.map((s) => s.file)).toEqual(
      expect.arrayContaining([
        "scripts/audit/prod-seed.mjs",
        "scripts/create-app-review-demo-account.mjs",
        "e2e/privacy/privacy-requests.spec.ts",
      ]),
    );
  });
});
