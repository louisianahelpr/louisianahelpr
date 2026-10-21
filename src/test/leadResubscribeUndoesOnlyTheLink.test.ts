/**
 * Q2161, owner 2026-10-21: a sign-up lead's Resubscribe undoes only an
 * unsubscribe that came from an email link. That holds because the link
 * (email-unsubscribe) is the ONLY writer of signup_leads.unsubscribed_at, and
 * every other stop (a bounce or complaint) lives in suppressed_emails, which
 * the reminder sweep checks and Resubscribe never clears. A second writer of
 * unsubscribed_at, or a sweep that stops checking suppression, breaks it.
 *
 * @mutate supabase/migrations/20261009223714_signup_leads.sql |         AND NOT EXISTS (SELECT 1 FROM public.suppressed_emails s WHERE lower(s.email) = l.email) |         AND true
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, resolve, relative } from "node:path";

const ROOT = resolve(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "node_modules" && name !== "test") walk(p, out); }
    else if (/\.(ts|tsx|mjs|sql)$/.test(name) && !/\.(test|spec)\./.test(name) && !name.endsWith("types.ts")) out.push(p);
  }
  return out;
}

describe("a lead's Resubscribe undoes only a link unsubscribe (Q2161)", () => {
  it("email-unsubscribe is the only writer of signup_leads.unsubscribed_at", () => {
    const writers: string[] = [];
    const files = ["src", "supabase/functions", "supabase/migrations"].flatMap((root) => walk(join(ROOT, root)));
    // Floor: 2965 files walked on 2026-10-21.
    expect(files.length).toBeGreaterThan(2700);
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      if (!/signup_leads/.test(s)) continue;
      // A JS write (`unsubscribed_at:` in an update/upsert/insert object) or a SQL one (`SET ... unsubscribed_at =`).
      if (/unsubscribed_at\s*:/.test(s) || /SET[^;]*\bunsubscribed_at\s*=/i.test(s)) writers.push(relative(ROOT, f));
    }
    expect(writers).toEqual(["supabase/functions/email-unsubscribe/index.ts"]);
  });
  it("the reminder sweep still honours suppressed_emails, which Resubscribe never clears", () => {
    const sweep = readFileSync(join(ROOT, "supabase/migrations/20261009223714_signup_leads.sql"), "utf8");
    expect(sweep).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.suppressed_emails s WHERE lower\(s\.email\) = l\.email\)/);
    const fn = readFileSync(join(ROOT, "supabase/functions/email-unsubscribe/index.ts"), "utf8");
    expect(fn).not.toMatch(/from\('suppressed_emails'\)\s*\.(delete|update)/);
  });
});
