/**
 * B40 (10-31, seen at 360 on Jobs > Working): a poster whose name read misses is "a neighbor" (useActivityData), and
 * the Working card took its first word: "Message a", "a hasn't replied yet". posterFirstName gives "" for a placeholder,
 * so the card says "them" / the plain line instead.
 *
 * @mutate src/lib/deletedPerson.ts |   if (!t \|\| t.toLowerCase() === "a neighbor" \|\| t === FORMER_MEMBER_LABEL) return ""; |   if (!t) return "";
 * @mutate src/components/job-card/jobStatusLine.ts |   const posterFirst = posterFirstName(app.posterName); |   const posterFirst = (app.posterName ?? "").split(" ")[0];
 */
import { describe, it, expect } from "vitest";
import { posterFirstName, FORMER_MEMBER_LABEL } from "@/lib/deletedPerson";
import { helperStatusLine } from "@/components/job-card/jobStatusLine";
import type { AppliedApp } from "@/components/job-card/activityConstants";

const applied = (posterName: string) =>
  ({
    id: "app-1",
    job_id: "job-1",
    status: "pending",
    created_at: new Date().toISOString(),
    posterName,
    job: { id: "job-1", status: "open", title: "Mow the lawn", customer_id: "poster-1", date_needed: "2099-09-19", start_time: "08:30:00", payment_status: "escrow" },
  }) as unknown as AppliedApp;

describe("a poster's first name never prints a placeholder", () => {
  it("names a real poster by first name", () => {
    expect(posterFirstName("Sam Lee")).toBe("Sam");
    expect(helperStatusLine(applied("Sam Lee")).detail).toBe("Sam hasn't replied yet");
  });

  it("gives nothing for the 'a neighbor' fallback or a former member, and the line drops the name", () => {
    expect(posterFirstName("a neighbor")).toBe("");
    expect(posterFirstName(FORMER_MEMBER_LABEL)).toBe("");
    expect(posterFirstName(undefined)).toBe("");
    const line = helperStatusLine(applied("a neighbor")).detail;
    expect(line).not.toMatch(/^a hasn't/i);
    expect(line).not.toMatch(/^Former /);
  });
});
