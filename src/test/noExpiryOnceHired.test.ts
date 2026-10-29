/**
 * NO "EXPIRED" CHIP ONCE ANYONE IS HIRED (audit 2026-10-28 A2-B9).
 *
 * The poster's card printed the listing's countdown, and a red "Expired" once jobs.expires_at passed, whenever
 * helper_id was null and the job was not cancelled. A crew job never sets helper_id, so a hired, working or
 * completed crew showed "Expired" (shots p2d-pjob-manage-p1-375.png, p2d-release-after-375.png); so did a one-Helpr
 * job whose Helpr deleted their account (helper_id nulled) after it was done. expires_at only ever closes an OPEN
 * listing nobody is hired on, so the chip now shows only then: status open, no helper_id, and no crew member hired
 * (crewIsBooked, the server's own "booked" test).
 *
 * @mutate src/pages/posts/postedJobCard/crewRefill.ts |   return job.status === "open" && !job.helper_id && !crewIsBooked(job, roster); |   return !job.helper_id && job.status !== "cancelled";
 * @mutate src/pages/posts/PostedJobCard.tsx | expiresAt={listingExpiryShown(job, initialGroupHelpers) ? job.expires_at : null} | expiresAt={!job.helper_id && job.status !== "cancelled" ? job.expires_at : null}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { listingExpiryShown } from "@/pages/posts/postedJobCard/crewRefill";

const crew = (status: string) => ({ status, helper_id: null, is_group_job: true });
const single = (status: string, helper_id: string | null) => ({ status, helper_id, is_group_job: false });
const hired = [{ helper_id: "h1" }, { helper_id: "h2" }];

describe("the listing's expiry shows only on an open job nobody is hired on (A2-B9)", () => {
  it("a crew that is hired, working or done shows no expiry", () => {
    for (const s of ["accepted", "in_progress", "completed", "disputed", "revision_requested"]) {
      expect(listingExpiryShown(crew(s), hired), s).toBe(false);
    }
  });

  it("an open crew with one member hired shows no expiry; an open crew nobody joined still does", () => {
    expect(listingExpiryShown(crew("open"), [{ helper_id: "h1" }])).toBe(false);
    expect(listingExpiryShown(crew("open"), [])).toBe(true);
  });

  it("one-Helpr jobs: open and unfilled shows it; offered, hired, done (even with the Helpr's account deleted) or cancelled does not", () => {
    expect(listingExpiryShown(single("open", null), undefined)).toBe(true);
    expect(listingExpiryShown(single("accepted", "h1"), undefined)).toBe(false);
    expect(listingExpiryShown(single("completed", null), undefined)).toBe(false);
    expect(listingExpiryShown(single("cancelled", null), undefined)).toBe(false);
  });

  it("the poster's card reads it, with the roster it already holds", () => {
    const card = blankComments(readFileSync(resolve(__dirname, "../pages/posts/PostedJobCard.tsx"), "utf8"));
    expect(card).toContain("expiresAt={listingExpiryShown(job, initialGroupHelpers) ? job.expires_at : null}");
  });
});
