/**
 * Push and email log every notification under ONE category (audit E2-12, D4-10).
 *
 * `notification_logs.category` is what an operator filters the admin log by.
 * The push log (`_shared/notificationLog.ts`) used to keep its own copy of
 * send-notification-email's category table "in step" by hand. It had drifted:
 *   - it had no Declutter type at all, so every Declutter push logged as
 *     `push/system` (prod, 2026-10-30: 23 of 23 Declutter pushes in 5 days);
 *   - `application`, `job_match`, `job_update(s)`, `expired` and `payment`
 *     logged under one category for push and another for email.
 * Both now read `_shared/notificationTypes.ts`. This calls the REAL push-log
 * category function for every type the table names and every type the
 * database CHECK permits, and checks the admin filter can show each category.
 */
// @mutate supabase/functions/_shared/notificationLog.ts |   return notificationLogCategory(notificationType); |   return notificationType?.startsWith("declutter_") ? "system" : notificationLogCategory(notificationType);
// @mutate supabase/functions/_shared/notificationLog.ts |   return notificationLogCategory(notificationType); |   return notificationType === "payment" ? "financial_alerts" : notificationLogCategory(notificationType);
// @mutate supabase/functions/_shared/notificationTypes.ts |   return NOTIFICATION_TYPE_MAP[type]?.category ?? UNMAPPED_NOTIFICATION_ROUTE.category |   return NOTIFICATION_TYPE_MAP[type]?.category ?? 'work_status'
// @mutate src/components/admin/AdminNotificationLogs.tsx |   declutter_wanted: "Declutter Wanted", |   declutter_wanted_posts: "Declutter Wanted",
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pushLogCategory } from "../../../supabase/functions/_shared/notificationLog";
import { NOTIFICATION_TYPE_MAP } from "../../../supabase/functions/_shared/notificationTypes";
import { blankComments } from "../helpers/blankNonCode";

const root = resolve(__dirname, "../../..");
const TYPES = Object.keys(NOTIFICATION_TYPE_MAP);

describe("push and email log a notification under one category", () => {
  it("reads a plausible table (guards the inventory)", () => {
    expect(TYPES.length).toBeGreaterThan(25);
    expect(TYPES.filter((t) => t.startsWith("declutter_")).length).toBeGreaterThan(6);
  });

  it("the push log uses the email category for every type", () => {
    const off = TYPES.filter((t) => pushLogCategory(t) !== NOTIFICATION_TYPE_MAP[t].category).map(
      (t) => `${t}: push=${pushLogCategory(t)} email=${NOTIFICATION_TYPE_MAP[t].category}`,
    );
    expect(off).toEqual([]);
  });

  it("no Declutter push is filed as system", () => {
    const system = TYPES.filter((t) => t.startsWith("declutter_") && pushLogCategory(t) === "system");
    expect(system).toEqual([]);
  });

  it("an unknown or missing type still logs, as system", () => {
    expect(pushLogCategory("not_a_type")).toBe("system");
    expect(pushLogCategory(null)).toBe("system");
  });

  it("send-notification-email has no table of its own", () => {
    const src = blankComments(
      readFileSync(resolve(root, "supabase/functions/send-notification-email/index.ts"), "utf8"),
    );
    expect(src).toMatch(/const TYPE_MAP = NOTIFICATION_TYPE_MAP\b/);
    expect(src).not.toMatch(/prefCol:\s*'/);
  });

  it("the admin log's category filter has a label for every category", () => {
    const src = blankComments(
      readFileSync(resolve(root, "src/components/admin/AdminNotificationLogs.tsx"), "utf8"),
    );
    const m = src.match(/const CATEGORY_LABEL: Record<string, string> = \{([\s\S]*?)\n\};/);
    expect(m).toBeTruthy();
    const labelled = new Set([...(m?.[1] ?? "").matchAll(/^\s*(\w+):/gm)].map((x) => x[1]));
    const categories = new Set(Object.values(NOTIFICATION_TYPE_MAP).map((r) => r.category));
    categories.add("system");
    const missing = [...categories].filter((c) => !labelled.has(c)).sort();
    expect(missing).toEqual([]);
  });
});
