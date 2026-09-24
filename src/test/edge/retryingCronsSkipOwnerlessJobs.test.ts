/**
 * AL-010: jobs.customer_id is nullable (a deleted poster), notifications.user_id
 * is NOT NULL. A cron that notifies `job.customer_id` AND treats a failed
 * insert as retryable (throw notifErr / markFailures) retries an ownerless job
 * on every run forever. Every such cron must exclude NULL customer_id in its
 * fetch. Inventory: every edge function that inserts `user_id: job.customer_id`.
 *
 * @mutate supabase/functions/expiring-jobs-push/index.ts | .not("customer_id", "is", null) | .order("id")
 * @mutate supabase/functions/payment-confirm-reminder/index.ts | .not("customer_id", "is", null) | .order("id")
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const notifiers = readdirSync("supabase/functions")
  .map((d) => join("supabase/functions", d, "index.ts"))
  .filter((f) => existsSync(f) && readFileSync(f, "utf8").includes("user_id: job.customer_id"));
const retrying = notifiers.filter((f) => /markFailures|throw notifErr/.test(readFileSync(f, "utf8")));

describe("retrying crons never fetch an ownerless job (AL-010)", () => {
  it("the inventory is real", () => {
    expect(notifiers.length).toBeGreaterThanOrEqual(5);
    expect(retrying.length).toBeGreaterThanOrEqual(2);
  });
  it("each retrying poster-notifier excludes NULL customer_id", () => {
    const bad = retrying.filter((f) => !readFileSync(f, "utf8").includes('.not("customer_id", "is", null)'));
    expect(bad).toEqual([]);
  });
});
