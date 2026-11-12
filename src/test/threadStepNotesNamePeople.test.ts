/**
 * A3-86 (audit 11-01): the thread's job step notes said "Helpr marked on the way." even to the Helpr, and "The
 * person who posted this job confirmed it complete." / "... requested a revision." to everyone. Now the one who took
 * the step reads "You ..." and the other side reads their first name ("Yusef is on the way.", "Dana approved it.").
 * A name is used only when the thread's other person IS the one who took the step (a crew thread falls back).
 *
 * @mutate src/lib/jobSystemEvents.ts |   const helpr = viewerId && viewerId === job.helper_id ? null : nameOf(job.helper_id, t("ce.yourHelpr")); |   const helpr = nameOf(job.helper_id, t("ce.yourHelpr"));
 * @mutate src/lib/jobSystemEvents.ts |   const poster = viewerId && viewerId === job.customer_id ? null : nameOf(job.customer_id, t("ce.thePoster")); |   const poster = "The person who posted this job";
 * @mutate src/lib/jobSystemEvents.ts |     (other?.first && id && other.id === id ? other.first : fallback); |     (other?.first ? other.first : fallback);
 * @mutate src/pages/messages/useMessagesData.ts | resolvedUserId, { id: convo.otherUserId ?? null, first: otherFirst }), | resolvedUserId),
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveJobSystemEvents, type JobTimestamps } from "@/lib/jobSystemEvents";
import { blankComments } from "./helpers/blankNonCode";

const job: JobTimestamps = {
  cancelled_at: null, cancelled_by: null, customer_id: "dana", helper_id: "yusef",
  helper_on_the_way_at: "2026-11-01T14:00:00Z", helper_arrived_at: "2026-11-01T14:30:00Z", helper_completed_at: "2026-11-01T16:00:00Z",
  poster_completed_at: "2026-11-01T17:00:00Z", revision_requested_at: "2026-11-01T16:30:00Z", disputed_at: null, disputed_by: null,
};
const labels = (viewer: string, other: { id: string | null; first: string } | null) =>
  Object.fromEntries(deriveJobSystemEvents(job, "j1", viewer, other).map((e) => [e.kind, e.label]));

describe("A3-86: the thread's step notes say You to the one who did it, the first name to the other side", () => {
  it("the Helpr's view", () => {
    const l = labels("yusef", { id: "dana", first: "Dana" });
    expect(Object.keys(l).length).toBeGreaterThan(4);
    expect(l).toMatchObject({
      helper_on_the_way: "You're on the way.", helper_arrived: "You arrived.", helper_completed: "You marked it done.",
      poster_confirmed_completed: "Dana approved it.", revision_requested: "Dana asked for a fix.",
    });
  });

  it("the poster's view", () => {
    expect(labels("dana", { id: "yusef", first: "Yusef" })).toMatchObject({
      helper_on_the_way: "Yusef is on the way.", helper_arrived: "Yusef arrived.", helper_completed: "Yusef marked it done.",
      poster_confirmed_completed: "You approved it.", revision_requested: "You asked for a fix.",
    });
  });

  it("the other person did not take the step (a crew member's thread) or has no name: no wrong name", () => {
    expect(labels("dana", { id: "crew-2", first: "Ana" }).helper_on_the_way).toBe("Your Helpr is on the way.");
    expect(labels("yusef", null).poster_confirmed_completed).toBe("The person who posted it approved it.");
  });

  it("the thread passes its other person in", () => {
    const src = blankComments(readFileSync("src/pages/messages/useMessagesData.ts", "utf8"));
    expect(src).toContain("resolvedUserId, { id: convo.otherUserId ?? null, first: otherFirst }),");
  });
});
