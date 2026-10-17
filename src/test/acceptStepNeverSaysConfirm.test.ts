/**
 * GUARD (Q1523): a Helpr ACCEPTS a job or a crew spot; "confirm" is only the
 * later day-before step (owner, 2026-10-07, Q1399).
 *
 * THE BUG: the single-Helpr card was moved to accept words with Q1399, but the
 * crew member's first step (CrewMemberSection, rpc_group_member_confirm) still
 * read "Confirm you'll be there...", "Confirm My Spot" and "You're confirmed
 * for this crew.", and the "you haven't accepted yet" refusals still said
 * "Confirm your spot first" / "Confirm this booking first".
 *
 * THE CLASS, from the app's own tables, every Helpr-facing sentence for the
 * not-yet-accepted state:
 *   - every CREW_ACCEPT_COPY entry (the crew member's accept step);
 *   - every refusal copy of rpc_group_member_confirm (the crew accept RPC);
 *   - every `helper_not_confirmed` refusal in RPC_ERROR_COPY (raised when
 *     helper_confirmed_at, the accept stamp, is still NULL);
 *   - HELPER_WAIT's offer and confirm_booking lines (the collapsed strip).
 * None of them may say confirm.
 *
 * @mutate src/pages/jobs/appliedJobCard/crewAcceptCopy.ts | button: "Accept My Spot", | button: "Confirm My Spot",
 * @mutate src/lib/lifecycleErrors.ts | "Accept this job first, then mark yourself on the way." | "Confirm this booking first, then mark yourself on the way."
 * @mutate src/pages/jobs/appliedJobCard/CrewMemberSection.tsx | label={busy ? "…" : CREW_ACCEPT_COPY.button} | label={busy ? "…" : "Confirm My Spot"}
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CREW_ACCEPT_COPY } from "@/pages/jobs/appliedJobCard/crewAcceptCopy";
import { RPC_ERROR_COPY } from "@/lib/lifecycleErrors";
import { ADMIN_RPC_ERROR_COPY } from "@/components/admin/adminRpcErrorCopy";
import { HELPER_WAIT } from "@/components/job-card/jobStatusLine";
import { blankComments } from "./helpers/blankNonCode";

const CONFIRM = /\bconfirm/i;

const sentences: Array<[string, string]> = [];
for (const [k, v] of Object.entries(CREW_ACCEPT_COPY)) sentences.push([`CREW_ACCEPT_COPY.${k}`, v]);
for (const [k, v] of Object.entries(RPC_ERROR_COPY.rpc_group_member_confirm)) {
  sentences.push([`rpc_group_member_confirm.${k}`, v]);
}
// Both tables: an admin-gated RPC keeps its copy in ADMIN_RPC_ERROR_COPY.
for (const [rpc, codes] of Object.entries({ ...RPC_ERROR_COPY, ...ADMIN_RPC_ERROR_COPY })) {
  const v = (codes as Record<string, string>).helper_not_confirmed;
  if (v) sentences.push([`${rpc}.helper_not_confirmed`, v]);
}
sentences.push(["HELPER_WAIT.offer", HELPER_WAIT.offer.detail]);
sentences.push(["HELPER_WAIT.confirm_booking", HELPER_WAIT.confirm_booking.detail]);

describe("the Helpr's accept step never says confirm (Q1523)", () => {
  it("reads the inventory (floor)", () => {
    // 2026-10-12: 7 crew accept lines, 3 crew-confirm refusals, 3 helper_not_confirmed, 2 strip lines.
    expect(sentences.length).toBeGreaterThan(12);
    expect(sentences.filter(([k]) => k.endsWith(".helper_not_confirmed")).length).toBeGreaterThan(2);
  });

  it.each(sentences)("%s says accept, not confirm", (_key, text) => {
    expect(text).not.toMatch(CONFIRM);
  });

  it("the crew card's accept step draws its words from CREW_ACCEPT_COPY, never an inline literal", () => {
    const src = blankComments(
      readFileSync(join(process.cwd(), "src/pages/jobs/appliedJobCard/CrewMemberSection.tsx"), "utf8"),
    );
    // Every string literal in the component (comments blanked) that says confirm
    // must be a poster-side step it names ("Confirm They Arrived"), not the accept.
    // Sentences only (a space inside): the step key "confirm" is an id, not copy.
    const literals = [...src.matchAll(/"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`/g)].map((m) => m[1] ?? m[2]);
    const confirmWords = literals.filter(
      (l) => / /.test(l) && CONFIRM.test(l) && !/Confirm They Arrived/.test(l),
    );
    expect(confirmWords).toEqual([]);
    expect(src).toContain("CREW_ACCEPT_COPY.button");
    expect(src).toContain("CREW_ACCEPT_COPY.hint");
  });
});
