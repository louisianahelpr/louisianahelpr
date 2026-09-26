/**
 * Q258: an auth email (signup confirm, reset, magic link) sat in the
 * `auth_emails` queue until the next process-email-queue cron tick
 * ('3-58/5 * * * *'): 156 s on average, up to 299 s, over the 72 auth emails of
 * the 60 days before 2026-09-26. Every function that enqueues into
 * `auth_emails` must kick the drain (kickEmailQueue) after a successful enqueue,
 * so a person waiting on their inbox never waits on the cron.
 *
 * Inventory: every edge function whose code (comments blanked) names the
 * `auth_emails` queue next to an enqueue_email call.
 *
 * @mutate supabase/functions/auth-email-hook/index.ts | kickEmailQueue(`auth:${emailType}`) | void (`auth:${emailType}`)
 * @mutate supabase/functions/_shared/kick-email-queue.ts | `${url}/functions/v1/process-email-queue` | `${url}/functions/v1/nothing`
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = "supabase/functions";

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

const enqueuers = tsFiles(ROOT)
  .map((file) => ({ file, code: blankComments(readFileSync(file, "utf8")) }))
  .filter(({ code }) => /rpc\(\s*['"]enqueue_email['"]/.test(code) && /queue_name:\s*['"]auth_emails['"]/.test(code));

describe("auth emails drain immediately (Q258)", () => {
  it("the inventory is real", () => {
    expect(enqueuers.map((e) => e.file)).toContain("supabase/functions/auth-email-hook/index.ts");
    expect(enqueuers.length).toBeGreaterThanOrEqual(1);
  });

  it("every auth_emails enqueuer kicks the drain after the enqueue", () => {
    const missing = enqueuers
      .filter(({ code }) => {
        const enq = code.search(/rpc\(\s*['"]enqueue_email['"]/);
        const kick = code.search(/\bkickEmailQueue\(/);
        return kick < 0 || kick < enq;
      })
      .map((e) => e.file);
    expect(missing).toEqual([]);
  });

  it("the kick posts to process-email-queue with the service key and runs in the background", () => {
    const code = blankComments(readFileSync(`${ROOT}/_shared/kick-email-queue.ts`, "utf8"));
    expect(code).toMatch(/fetch\(`\$\{url\}\/functions\/v1\/process-email-queue`/);
    expect(code).toMatch(/Authorization: `Bearer \$\{key\}`/);
    expect(code).toMatch(/waitUntil\(run\)/);
    // A failed kick must never throw into the hook: the cron is the fallback.
    expect(code).toMatch(/\.catch\(/);
  });
});
