/**
 * A BOOKED CREW READS AS HIRED ON THE ONE TRACKER (audit 2026-10-28 A2-B8, lead 2026-10-29).
 *
 * A crew job (is_group_job) never sets helper_id (the members are on group_job_helpers), and it leaves `open` only
 * once its crew is hired. jobProgress read "hired" from helper_id alone, so a member's tracker on a booked crew read
 * "Posted · They haven't replied yet" (measured by calling jobProgress with the job page's row). Now a crew past
 * `open` counts as hired; a one-Helpr job is unchanged, and an open crew is still Posted.
 *
 * @mutate src/components/tracker/jobProgressState.ts |   return !!job.helper_id \|\| (job.is_group_job === true && !!job.status && job.status !== "open"); |   return !!job.helper_id;
 */
import { describe, expect, it } from "vitest";
import { jobProgress } from "@/components/tracker/jobProgressState";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const DAY = jobLocalDateISO(5);
const crew = (status: string) =>
  ({ id: "j", status, helper_id: null, is_group_job: true, payment_status: "escrow", date_needed: DAY, start_time: "09:00" }) as const;

describe("a booked crew reads as hired (A2-B8)", () => {
  it("a crew member on a booked ('accepted') crew is past Posted, and is never told they haven't replied", () => {
    const p = jobProgress(crew("accepted"), { viewer: "helpr" });
    expect(p.stage).not.toBeNull();
    expect(p.stage!).toBeGreaterThan(0);
    expect(`${p.word} ${p.next}`).not.toMatch(/haven't replied|Posted/);
  });

  it("an open crew (still staffing) is still Posted", () => {
    expect(jobProgress(crew("open"), { viewer: "helpr" }).stage).toBe(0);
  });

  it("a one-Helpr job with nobody on it is unchanged", () => {
    const p = jobProgress({ ...crew("accepted"), is_group_job: false }, { viewer: "helpr" });
    expect(p.stage === null || p.stage === 0).toBe(true);
  });
});
