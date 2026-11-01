/**
 * Expired is not cancelled, in a message thread that names the job (owner 10-31, OWNER-DECISIONS "Expired jobs
 * are not cancellations"; lead item 2 for B44).
 *
 * Before: auto-expire-jobs closes an unfilled listing as status 'cancelled' with no cancelled_by, and Messages read
 * the raw status, so an applicant who had messaged the poster saw a "Cancelled" chip in the inbox and the chat
 * header, "This conversation is closed — the job was cancelled", and the pill "Job was cancelled.". Now the poster
 * reads Expired and anyone else reads Closed / no longer open; a person's real cancellation reads as before.
 *
 * Class half, from source: every Messages file that labels a job status goes through threadJobChipLabel (never a
 * bare jobStatusLabel), every jobs read in loadConversations carries the expiry marker's columns, and both
 * closed-thread copy sites ask expiredCopyFor first.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deriveJobSystemEvents, type JobTimestamps } from "@/lib/jobSystemEvents";
import { threadJobChipLabel, expiredCopyFor, EXPIRED_IN_THREAD } from "@/lib/expiredListingInThread";
import { buildTimeline } from "@/components/messages/chatView/chatViewHelpers";
import { patchThreadForAnnouncement } from "@/components/messages/jobStatusAnnouncement";
import type { Message } from "@/components/messages/types";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

// @mutate src/lib/jobSystemEvents.ts |   const expired = job.cancelled_at && jobIsExpiredListing(job) |   const expired = false && jobIsExpiredListing(job)
// @mutate src/lib/expiredListingInThread.ts |   if (status === "cancelled") { |   if (status === "x-cancelled") {
// @mutate src/components/messages/ConversationRow.tsx |     const label = threadJobChipLabel(s, c); |     const label = jobStatusLabel(s);
// @mutate src/pages/messages/messagesData/loadConversations.ts | select("id, title, status, customer_id, helper_id, cancelled_by, cancellation_reason").in("id", jobIds) | select("id, title, status, customer_id, helper_id").in("id", jobIds)
// @mutate src/components/messages/jobStatusAnnouncement.ts |   { matches: /\bno longer open\b/i, jobStatus: "cancelled", closesAt: (at) => at, expired: true }, |
// @mutate src/components/messages/chatView/chatViewHelpers.ts |     { kind: "cancelled", matches: /\bcancell?ed\b\|\bno longer open\b/i }, |     { kind: "cancelled", matches: /\bcancell?ed\b/i },
// @mutate src/components/messages/chatView/ChatComposer.tsx | {(expiredCopyFor(activeConvo) ?? threadClosedCopy(activeConvo.jobStatus)).notice} | {threadClosedCopy(activeConvo.jobStatus).notice}

const REPO = resolve(__dirname, "../..");
const code = (f: string) => blankComments(readFileSync(resolve(REPO, f), "utf8"));

const POSTER = "11111111-1111-4111-8111-111111111111";
const APPLICANT = "22222222-2222-4222-8222-222222222222";
const base: JobTimestamps = {
  cancelled_at: "2026-10-30T12:00:00Z",
  cancelled_by: null,
  customer_id: POSTER,
  helper_arrived_at: null,
  helper_completed_at: null,
  helper_id: null,
  helper_on_the_way_at: null,
  poster_completed_at: null,
  revision_requested_at: null,
  disputed_at: null,
  disputed_by: null,
  status: "cancelled",
  // auto-expire-jobs/index.ts's reason, verbatim.
  cancellation_reason: "Job listing expired — scheduled time passed with no Helpr assigned",
};

describe("an expired listing in a message thread", () => {
  it("the pill: the poster reads that it expired; anyone else never reads Cancelled or Expired", () => {
    const poster = deriveJobSystemEvents(base, "j1", POSTER);
    expect(poster.map((e) => e.label)).toEqual([EXPIRED_IN_THREAD.poster.event]);
    const other = deriveJobSystemEvents(base, "j1", APPLICANT);
    expect(other.map((e) => e.label)).toEqual(["This job is no longer open."]);
    for (const e of other) expect(e.label).not.toMatch(/cancel|expire/i);
    // No viewer known: the safe reading is the non-poster one.
    expect(deriveJobSystemEvents(base, "j1").map((e) => e.label)).toEqual([EXPIRED_IN_THREAD.other.event]);
  });

  it("a person's cancellation still says who cancelled", () => {
    expect(deriveJobSystemEvents({ ...base, cancelled_by: POSTER, cancellation_reason: "Plans changed" }, "j1", APPLICANT)[0].label)
      .toBe("Job cancelled by the person who posted it.");
    // A poster who TYPES the sweep's reason is still a cancellation (cancelled_by is the marker).
    expect(deriveJobSystemEvents({ ...base, cancelled_by: POSTER }, "j1", APPLICANT)[0].label)
      .toBe("Job cancelled by the person who posted it.");
  });

  it("the chip: Expired for the poster, Closed for anyone else, Cancelled only for a real cancellation", () => {
    expect(threadJobChipLabel("cancelled", { jobExpired: true, viewerIsPoster: true })).toBe("Expired");
    expect(threadJobChipLabel("cancelled", { jobExpired: true, viewerIsPoster: false })).toBe("Closed");
    expect(threadJobChipLabel("cancelled", { jobExpired: false, viewerIsPoster: false })).toBe("Cancelled");
    expect(threadJobChipLabel("open", { jobExpired: true, viewerIsPoster: false })).toBe("Open");
  });

  it("the closed-thread notice and toast never say cancelled or expired to a non-poster", () => {
    const other = expiredCopyFor({ jobExpired: true, viewerIsPoster: false })!;
    for (const s of [other.chip, other.event, other.notice, other.toast]) expect(s).not.toMatch(/cancel|expire/i);
    const poster = expiredCopyFor({ jobExpired: true, viewerIsPoster: true })!;
    for (const s of [poster.notice, poster.toast]) expect(s).toMatch(/expired/i);
    expect(expiredCopyFor({ jobExpired: false, viewerIsPoster: true })).toBeNull();
  });

  it("the stored '✕ Job cancelled' row is dropped under the expired pill", () => {
    const stored = { id: "m1", content: "✕ Job cancelled", is_system: true, created_at: "2026-10-30T12:00:01Z", sender_id: POSTER, receiver_id: APPLICANT } as unknown as Message;
    const said = { id: "m0", content: "Is this still open?", is_system: false, created_at: "2026-10-29T12:00:00Z", sender_id: APPLICANT, receiver_id: POSTER } as unknown as Message;
    const items = buildTimeline([said, stored], deriveJobSystemEvents(base, "j1", APPLICANT), false);
    // What a reader sees: message bodies and pill labels (an event's id/kind are not shown).
    const shown = items.flatMap((i) => {
      const it = i as { message?: { content?: string }; event?: { label?: string } };
      return [it.message?.content, it.event?.label].filter((x): x is string => typeof x === "string");
    });
    expect(shown).toEqual(["Is this still open?", "This job is no longer open."]);
  });
});

describe("the server's expired-listing row (20261101011526: '✕ No longer open')", () => {
  const row = { id: "m2", content: "✕ No longer open", is_system: true, created_at: "2026-10-30T12:00:01Z", sender_id: POSTER, receiver_id: APPLICANT } as unknown as Message;

  it("closes the thread live and marks it expired, so the chip reads Closed/Expired, not Cancelled", () => {
    const convo = { jobId: "j1", jobStatus: "open", messagingClosesAt: null, viewerIsPoster: false } as never;
    const out = patchThreadForAnnouncement(convo, { job_id: "j1", content: "✕ No longer open", created_at: "2026-10-30T12:00:01Z", is_system: true });
    expect(out.jobStatus).toBe("cancelled");
    expect(out.jobExpired).toBe(true);
    expect(out.messagingClosesAt).toBe("2026-10-30T12:00:01.000Z");
    expect(threadJobChipLabel(out.jobStatus!, out)).toBe("Closed");
  });

  it("is dropped under the pill, so the poster reads only that it expired", () => {
    const items = buildTimeline([row], deriveJobSystemEvents(base, "j1", POSTER), false);
    const shown = items.flatMap((i) => {
      const it = i as { message?: { content?: string }; event?: { label?: string } };
      return [it.message?.content, it.event?.label].filter((x): x is string => typeof x === "string");
    });
    expect(shown).toEqual([EXPIRED_IN_THREAD.poster.event]);
  });
});

describe("class: every Messages job-status surface goes through the expiry rule", () => {
  const files = trackedFiles("src")
    .filter((f) => /^src\/(components|pages)\/messages\//.test(f) && /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

  it("no Messages file labels a job status with a bare jobStatusLabel", () => {
    expect(files.length).toBeGreaterThan(20);
    const chipFiles = files.filter((f) => /threadJobChipLabel\(/.test(code(f)));
    expect(chipFiles.sort()).toEqual(["src/components/messages/ChatHeader.tsx", "src/components/messages/ConversationRow.tsx"]);
    expect(files.filter((f) => /\bjobStatusLabel\(/.test(code(f)))).toEqual([]);
  });

  it("every jobs read in loadConversations carries the expiry marker's columns", () => {
    const src = code("src/pages/messages/messagesData/loadConversations.ts");
    const selects = [...src.matchAll(/from\("jobs"\)\s*\.select\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(selects.length).toBeGreaterThan(1);
    for (const s of selects) {
      expect(s).toContain("cancelled_by");
      expect(s).toContain("cancellation_reason");
      expect(s).toContain("helper_id");
    }
  });

  it("both closed-thread copy sites ask expiredCopyFor first", () => {
    for (const f of ["src/components/messages/chatView/ChatComposer.tsx", "src/pages/messages/messagesData/sendHandlers.ts"]) {
      const src = code(f);
      expect(src, f).toMatch(/expiredCopyFor\([^)]*\)\s*\?\?\s*threadClosedCopy\(/);
    }
  });
});
