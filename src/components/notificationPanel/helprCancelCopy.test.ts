/**
 * F176 follow-up (lh-silent-failure review, 11-09): notify_on_job_update's Helpr copy now says who cancelled
 * (20261109231855), and the bell picked its pill by the old "cancelled by the person who posted" text, so the new
 * "by our team." / "after our team decided the dispute." / "was cancelled." rows fell through to "Repost" (a
 * poster-only action) for a Helpr. Every sentence the trigger can write, read from the NEWEST migration, must count as
 * the Helpr's copy; a poster's own "Job cancelled" notice must not.
 *
 * @mutate src/components/notificationPanel/helprCancelCopy.ts |   return n.title === "Job cancelled" && HELPR_CANCEL_NOTICE_TAIL.test(n.message); |   return false;
 * @mutate src/components/notificationPanel/helprCancelCopy.ts | /" was cancelled(?: by our team\| after our team decided the dispute)?\.$/ | /" was cancelled(?: by our team)?\.$/
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { isHelprCancelCopy } from "./helprCancelCopy";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";
import { blankSqlComments } from "@/test/helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../../supabase/migrations"));
const trigger = blankSqlComments(DEFS.get("notify_on_job_update")?.stmt ?? "");
/** Every tail the trigger's cancel CASE can append after '"<title>" was cancelled', from its newest text. */
const tails = [...trigger.matchAll(/THEN '((?:[^']|'')*)'|ELSE '((?:[^']|'')*)'/g)]
  .map((m) => (m[1] ?? m[2]).replace(/''/g, "'"))
  .filter((t) => t === "." || t.startsWith(" by ") || t.startsWith(" after "));

describe("the bell gives the Helpr's copy of a job cancel 'View', never 'Repost'", () => {
  it("reads the trigger's cancel sentences from the newest definition (floor)", () => {
    expect(tails.length).toBeGreaterThan(3);
  });
  it("every sentence notify_on_job_update can write is the Helpr's copy", () => {
    for (const t of tails) {
      expect(isHelprCancelCopy({ type: "warning", title: "Job cancelled", message: `"Move a dresser" was cancelled${t}` }), t).toBe(true);
    }
  });
  it("legacy stored rows still match", () => {
    expect(isHelprCancelCopy({ type: "warning", title: "Job cancelled", message: '"Rake" has been cancelled by the poster.' })).toBe(true);
  });
  it("a poster's own cancel notice, another type, or another title does not", () => {
    expect(isHelprCancelCopy({ type: "warning", title: "Job cancelled", message: '"Rake" was cancelled. Because it was cancelled late, $5 of your payment goes to the Helpr.' })).toBe(false);
    expect(isHelprCancelCopy({ type: "info", title: "Job cancelled", message: '"Rake" was cancelled by our team.' })).toBe(false);
    expect(isHelprCancelCopy({ type: "warning", title: "Job auto-cancelled", message: '"Rake" was cancelled.' })).toBe(false);
  });
});
