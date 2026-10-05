/**
 * Q1106 — every cron-authenticated edge function declares verify_jwt = false.
 *
 * A function that authenticates its caller itself (Bearer CRON_SECRET or the
 * service-role key, compared in its handler) must not ALSO depend on the
 * gateway's JWT check: with no `[functions.<name>] verify_jwt = false` stanza
 * it runs on the gateway default (true) and reaches its handler only because
 * pg_cron happens to send the vault `service_role_key`, a LEGACY key that is a
 * JWT. Rotate to the new non-JWT secret keys and those functions go 401 while
 * the handler would have accepted the call. On 2026-09-10 three had no stanza
 * (daily-match-digest, saved-helper-availability-push, str-ical-sync), by an
 * acknowledged omission in config.toml. 2026-10-05: stanzas added.
 *
 * The class is derived from the functions' own source (a handler that reads
 * CRON_SECRET into `cronSecret`, or calls verifyCronSecret), not a list. 2026-10-05 the class found SEVEN without a
 * stanza: the three above plus arrival-confirm-reminder, instant-job-match,
 * slack-ops-alert and stalled-completion-reminder (all verify_jwt true live).
 * Each must also really check the token in its handler, so verify_jwt = false
 * never opens a door: the guard requires a `Bearer ${...}` comparison or
 * verifyCronSecret().
 */
// Registered mutations - each turns this guard RED on its own:
// @mutate supabase/config.toml |   [functions.str-ical-sync]\n    verify_jwt = false |   [functions.str-ical-sync-gone]\n    verify_jwt = false
// @mutate supabase/config.toml |   [functions.daily-match-digest]\n    verify_jwt = false |   [functions.daily-match-digest]\n    verify_jwt = true
// @mutate supabase/functions/daily-match-digest/index.ts |     if (!authHeader \|\| ((!cronSecret \|\| authHeader !== `Bearer ${cronSecret}`) && (!serviceRoleKey \|\| authHeader !== `Bearer ${serviceRoleKey}`))) { |     if (false) {
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();
const FN_DIR = join(ROOT, "supabase/functions");
const config = readFileSync(join(ROOT, "supabase/config.toml"), "utf8")
  .split("\n")
  .map((l) => l.replace(/#.*$/, ""))
  .join("\n");

/** verify_jwt per [functions.<name>] stanza, as config.toml declares it. */
function stanzas(): Map<string, boolean | undefined> {
  const out = new Map<string, boolean | undefined>();
  let current: string | null = null;
  for (const line of config.split("\n")) {
    const head = /^\s*\[functions\.([a-z0-9-]+)\]\s*$/.exec(line);
    if (head) {
      current = head[1];
      out.set(current, undefined);
      continue;
    }
    if (/^\s*\[/.test(line)) {
      current = null;
      continue;
    }
    const v = /^\s*verify_jwt\s*=\s*(true|false)\s*$/.exec(line);
    if (current && v) out.set(current, v[1] === "true");
  }
  return out;
}

function sourceOf(fn: string): string {
  const dir = join(FN_DIR, fn);
  return readdirSync(dir)
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".gen.ts"))
    .map((f) => blankComments(readFileSync(join(dir, f), "utf8")))
    .join("\n");
}

const functions = readdirSync(FN_DIR).filter((d) => !d.startsWith("_") && statSync(join(FN_DIR, d)).isDirectory());
/**
 * The class: a handler that reads the cron secret into its `cronSecret`
 * (the repo's convention for caller auth) or calls verifyCronSecret. A
 * CRON_SECRET read under another name is an HMAC signing key (email-tracking,
 * email-unsubscribe, send-account-status-email), not caller auth.
 */
const READS_CRON_SECRET = /\bcronSecret\s*=\s*Deno\.env\.get\(\s*["']CRON_SECRET["']\s*\)|\bverifyCronSecret\s*\(/;
const CHECKS_CALLER = /`Bearer \$\{\s*cronSecret\s*\}`|\bverifyCronSecret\s*\(/;
const cronAuthed = functions.filter((fn) => READS_CRON_SECRET.test(sourceOf(fn)));
const declared = stanzas();

describe("Q1106: cron-authenticated edge functions declare verify_jwt = false", () => {
  it("the inventory is real", () => {
    expect(functions.length).toBeGreaterThan(50);
    expect(cronAuthed.length).toBeGreaterThan(15);
    expect(declared.size).toBeGreaterThan(40);
  });

  it("each has a [functions.<name>] stanza with verify_jwt = false", () => {
    const missing = cronAuthed.filter((fn) => declared.get(fn) !== false).sort();
    expect(missing, "add `[functions.<name>]\\n    verify_jwt = false` to supabase/config.toml").toEqual([]);
  });

  it("each really checks the caller's token in its handler", () => {
    const unchecked = cronAuthed
      .filter((fn) => {
        const src = sourceOf(fn);
        return !CHECKS_CALLER.test(src);
      })
      .sort();
    expect(unchecked).toEqual([]);
  });
});
