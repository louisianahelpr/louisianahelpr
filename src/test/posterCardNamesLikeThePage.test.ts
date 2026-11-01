/**
 * JA-35 (Jobs audit 2026-11-01): the poster's Posted card, waiting on a Helpr who is on the way, offered
 * "Message Yusef" plus "Manage job"; the job page for the same job dropped "Manage job" on the owner's word (10-31,
 * "never a generic Manage job") and calls the same thing "More options". Card and page now use the same name.
 * Inventory: every PosterWait the card face handles, each drawn with a Helpr and without one.
 *
 * @mutate src/pages/posts/postedJobCard/posterFaceAction.ts | export const POSTER_CONTROLS_LABEL = "More options"; | export const POSTER_CONTROLS_LABEL = "Manage job";
 */
import { describe, expect, it } from "vitest";
import { posterFaceAction, type PosterFaceHandlers } from "@/pages/posts/postedJobCard/posterFaceAction";
import { POSTER_WAIT } from "@/components/job-card/jobStatusLine";

const noop = () => {};
const h: PosterFaceHandlers = {
  pendingApplicants: 2, helperName: "Yusef B.", confirmingArrival: false, completing: false, tipsReady: false,
  openApplicants: noop, confirmArrival: noop, approve: noop, review: noop, tip: noop, postAgain: noop, message: noop,
  manage: noop, confirm: noop, noShow: noop, cancel: noop, viewDispute: noop,
};

describe("JA-35: the poster's card names its controls as the job page does", () => {
  const waits = Object.keys(POSTER_WAIT);
  it("covers the whole wait inventory", () => {
    expect(waits.length).toBeGreaterThan(15);
  });

  it("on the way (waiting on the Helpr): Message <name>, and the small link says More options", () => {
    const a = posterFaceAction("on_the_way" as never, { is_group_job: false, helper_id: "h1" }, h);
    expect(a.label).toBe("Message Yusef");
    expect(a.also?.label).toBe("More options");
  });

  for (const wait of waits) {
    it(`${wait}: never "Manage job"`, () => {
      for (const job of [{ is_group_job: false, helper_id: "h1" }, { is_group_job: false, helper_id: null }, { is_group_job: true, helper_id: null }]) {
        const a = posterFaceAction(wait as never, job, h);
        expect(a.label).not.toMatch(/manage job/i);
        expect(a.also?.label ?? "").not.toMatch(/manage job/i);
      }
    });
  }
});
