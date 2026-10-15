#!/usr/bin/env node
/**
 * Rotate the App Store reviewer's demo password (docs/OPEN.md Q1790).
 *
 *   node scripts/rotate-review-demo-password.mjs            # dry run: finds the account, changes nothing
 *   node scripts/rotate-review-demo-password.mjs --apply    # rotates (refused while the review freeze is on)
 *
 * WHY: fastlane/metadata/review_information/demo_password.txt holds the
 * reviewer account's password in a PUBLIC repo. Owner decision 2026-10-15:
 * change it, but only AFTER Apple decides on build 7119 (a password change
 * mid-review would lock the reviewer out). So --apply refuses while
 * release/app-review-freeze.json says `frozen: true`.
 *
 * ORDER (no step can lose the new password):
 *   1. generate a new password (never printed);
 *   2. store it as the GitHub secret ASC_REVIEW_DEMO_PASSWORD (gh secret set,
 *      value on stdin) and in a 0600 file under ~/.lh-backups/ for the owner;
 *   3. only then set it on the account through the Supabase Auth admin API.
 * A failure after step 2 leaves the old password working and an unused secret;
 * re-running fixes it.
 *
 * AFTER --apply (printed as the next steps): `git rm` the tracked password
 * file, add it to .gitignore, and dispatch ios-metadata.yml, whose Fastfile
 * stages the secret into the temporary upload copy only.
 *
 * Exit codes: zero when done (or a clean dry run); one when refused or a step
 * failed; two when the account or the freeze file could not be read.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_SUPABASE_URL, resolveServiceKey } from "./lib/adminSession.mjs";

export const REVIEWER_EMAIL = "apple-reviewer@louisianahelpr.com";
export const SECRET_NAME = "ASC_REVIEW_DEMO_PASSWORD";

/** Why --apply must not run now, or null. */
export function refusal({ apply, freeze }) {
  if (!apply) return null;
  if (!freeze || typeof freeze.frozen !== "boolean") return "release/app-review-freeze.json is unreadable: refusing to guess whether App Review is still running";
  if (freeze.frozen) return `App Review of ${freeze.version} (${freeze.build}) is still running (release/app-review-freeze.json frozen: true). Owner 2026-10-15: rotate only after Apple decides.`;
  return null;
}

/** A 24-character URL-safe password. */
export function newPassword(bytes = randomBytes) {
  return bytes(18).toString("base64url");
}

/** The reviewer's auth user id, paging the admin list; null when absent. */
export async function findUserId({ fetchImpl, url, key, email = REVIEWER_EMAIL }) {
  for (let page = 1; page <= 20; page += 1) {
    const res = await fetchImpl(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`admin user list answered ${res.status}`);
    const body = await res.json();
    const users = Array.isArray(body?.users) ? body.users : [];
    const hit = users.find((u) => String(u.email ?? "").toLowerCase() === email);
    if (hit) return hit.id;
    if (users.length < 200) return null;
  }
  return null;
}

/**
 * The whole rotation, with every side effect injected (the test drives it).
 * Returns { code, lines }; `lines` never contain the password.
 */
export async function rotate({ apply, freeze, fetchImpl, url, key, setSecret, writeBackup, gen = newPassword }) {
  const lines = [];
  const why = refusal({ apply, freeze });
  if (why) return { code: 1, lines: [`REFUSED: ${why}`] };
  if (!key) return { code: 2, lines: ["no service-role key (SUPABASE_SERVICE_ROLE_KEY or .env): cannot reach the Auth admin API"] };
  let id;
  try {
    id = await findUserId({ fetchImpl, url, key });
  } catch (e) {
    return { code: 2, lines: [`could not read the auth users: ${e.message}`] };
  }
  if (!id) return { code: 2, lines: [`no auth user ${REVIEWER_EMAIL}`] };
  lines.push(`reviewer account: ${REVIEWER_EMAIL} (${id})`);
  if (!apply) {
    lines.push("DRY RUN: nothing changed. --apply rotates it once release/app-review-freeze.json says frozen: false.");
    return { code: 0, lines };
  }
  const password = gen();
  const stored = setSecret(password);
  if (!stored.ok) return { code: 1, lines: [...lines, `gh secret set ${SECRET_NAME} failed (${stored.why}); the account was NOT changed`] };
  lines.push(`GitHub secret ${SECRET_NAME} set`);
  lines.push(`backup written: ${writeBackup(password)} (mode 600)`);
  const res = await fetchImpl(`${url}/auth/v1/admin/users/${id}`, {
    method: "PUT",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) return { code: 1, lines: [...lines, `the account update answered ${res.status}: the OLD password still works; re-run to retry`] };
  lines.push("account password changed");
  lines.push("NEXT: git rm fastlane/metadata/review_information/demo_password.txt; add it to .gitignore; dispatch ios-metadata.yml; tick Q1790 with its guard.");
  return { code: 0, lines };
}

function ghSetSecret(password) {
  const r = spawnSync("gh", ["secret", "set", SECRET_NAME, "--repo", "louisianahelpr/louisianahelpr"], { input: password, encoding: "utf8" });
  return r.status === 0 ? { ok: true } : { ok: false, why: `exit ${r.status}: ${String(r.stderr).trim().slice(0, 200)}` };
}

function backupFile(password) {
  const dir = join(homedir(), ".lh-backups");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `review-demo-password-${new Date().toISOString().slice(0, 10)}.txt`);
  writeFileSync(path, `${REVIEWER_EMAIL}\n${password}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let freeze = null;
  try {
    freeze = JSON.parse(readFileSync(new URL("../release/app-review-freeze.json", import.meta.url), "utf8"));
  } catch {
    freeze = null; // refusal() names the unreadable file
  }
  const { code, lines } = await rotate({
    apply: process.argv.includes("--apply"),
    freeze,
    fetchImpl: fetch,
    url: process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL,
    key: resolveServiceKey(),
    setSecret: ghSetSecret,
    writeBackup: backupFile,
  });
  for (const l of lines) console.log(l);
  process.exit(code);
}
