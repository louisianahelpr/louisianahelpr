/**
 * Q1402: a crew member's collapsed strip names the step their card offers.
 *
 * A hired crew member whose spot is not confirmed yet sees one button on the
 * expanded card, "Accept My Spot" (CrewMemberSection, CREW_ACCEPT_COPY: a crew
 * member accepts, never confirms, Q1523 / owner Q1399). Their collapsed strip
 * (CrewStatusStrip, through helperStatusLine) used to read the single-Helpr
 * offer's sentence, "Accept or decline it" or "<Name> offered you this job":
 * a choice that card does not offer. The single-Helpr offer keeps its words
 * (Q1399: accept, not confirm).
 *
 * @mutate src/components/job-card/jobStatusLine.ts | return job.is_group_job ? "confirm_spot" : "confirm_booking"; | return "confirm_booking";
 * @mutate src/components/job-card/jobStatusLine.ts |   confirm_spot: { detail: "Accept your spot" }, |   confirm_spot: { detail: "Accept or decline it" },
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { helperStatusLine } from "@/components/job-card/jobStatusLine";
import type { AppliedApp } from "@/components/job-card/activityConstants";
import { blankComments } from "@/test/helpers/blankNonCode";
import { CREW_ACCEPT_COPY } from "@/pages/jobs/appliedJobCard/crewAcceptCopy";

const HELPER = "helper-1";
const app = (job: Record<string, unknown>) =>
  ({
    id: "app-1", job_id: "job-1", helper_id: HELPER, status: "accepted",
    posterName: "Pierre B.", created_at: new Date().toISOString(),
    job: { id: "job-1", title: "Move a couch", date_needed: "2099-01-01", ...job },
  }) as unknown as AppliedApp;

describe("a crew member's strip names the crew card's own step (Q1402)", () => {
  // The button renders CREW_ACCEPT_COPY.button (Q1523): read the label from
  // there once the card is shown to wire that constant to its onConfirm button.
  const wired = /label=\{busy \? "…" : CREW_ACCEPT_COPY\.button\} onClick=\{onConfirm\}/.test(
    blankComments(readFileSync("src/pages/jobs/appliedJobCard/CrewMemberSection.tsx", "utf8")),
  );
  const crewButton = wired ? CREW_ACCEPT_COPY.button : undefined;

  it("the crew card's confirm button is found (floor)", () => {
    expect(crewButton, "CrewMemberSection's onConfirm button label").toBeTruthy();
  });

  it("an unconfirmed crew member's strip asks for the same step as the button", () => {
    const line = helperStatusLine(app({ status: "accepted", is_group_job: true, helper_confirmed_at: null }));
    expect(line.id).toBe("confirm_spot");
    expect(line.owesConfirmation).toBe(true);
    // "Accept My Spot" on the button, "Accept your spot" on the strip.
    const words = (s: string) => s.toLowerCase().replace(/\b(my|your)\b/g, "").replace(/\s+/g, " ").trim();
    expect(words(line.detail)).toBe(words(crewButton!));
    expect(line.detail).not.toMatch(/decline|offered|confirm/i);
  });

  it("a single Helpr's unanswered hire keeps the offer's words", () => {
    const line = helperStatusLine(app({ status: "accepted", helper_id: HELPER, helper_confirmed_at: null }));
    expect(line.id).toBe("confirm_booking");
    expect(line.detail).toMatch(/offered you this job|accept or decline/i);
  });
});
