/**
 * A2-C40 (audit 2026-10-29, AA9 1a, the 15:27 notification), the notification half. sweep_no_show_alerts said
 * "was scheduled to start 30 minutes ago" (the 15-minute sweep lands it 30 to 45 minutes after the start, or
 * later), "your helpr" in lowercase, and "you can mark this as a no-show in the app" for a job still 'accepted',
 * whose card offers no No-Show (that control lives on the in_progress card only, InProgressStep).
 *
 * Read from the NEWEST definition (effectiveDefs: any dollar-quote tag), comments blanked.
 *
 * @mutate supabase/migrations/20261029173937_no_show_alert_says_the_start_time.sql | 'Has your Helpr arrived?', | 'Has your helpr arrived?',
 * @mutate supabase/migrations/20261029173937_no_show_alert_says_the_start_time.sql | If your Helpr hasn''t arrived, message them from the job.', rec.title | If your Helpr hasn''t arrived, you can mark this as a no-show in the app.', rec.title
 * @mutate supabase/migrations/20261029173937_no_show_alert_says_the_start_time.sql | and not everyone on the crew has checked in. If someone hasn''t arrived, message them from the job.' | and not everyone on the crew has checked in. Thirty minutes ago it was due.'
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));

describe("the no-show alert says the start time, Helpr, and no No-Show the card lacks (A2-C40)", () => {
  const def = defs.get("sweep_no_show_alerts");
  const body = blankSqlComments(def?.stmt ?? "");

  it("reads the newest definition (inventory floor)", () => {
    expect(def?.file).toBe("20261029173937_no_show_alert_says_the_start_time.sql");
    // Four messages: poster and Helpr, one-off and crew.
    expect(body.match(/was scheduled to start at %s/g)?.length).toBe(4);
  });

  it("never says a fixed '30 minutes ago', a lowercase helpr, or points at a no-show", () => {
    expect(body).not.toMatch(/minutes ago/);
    expect(body).not.toMatch(/\bhelpr\b/);
    expect(body).not.toMatch(/no-show in the app|as a no-show/i);
  });
});
