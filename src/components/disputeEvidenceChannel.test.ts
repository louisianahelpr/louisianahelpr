/**
 * Who may add follow-up evidence to a dispute, and through which write.
 *
 * A dispute an admin re-opened with rpc_supersede_dispute_decision has no
 * opener (opener_id NULL). The dialog's only evidence write was the opener's
 * own UPDATE, so on that dispute NEITHER party could attach anything to the
 * decision being re-made (round-5 lh-money-escrow review, LOW-1). Both parties
 * now go through rpc_add_dispute_evidence there; a party-filed dispute keeps
 * its opener-only rule.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { disputeEvidenceChannel, REOPENED_REASON_PREFIX } from "./disputeEvidenceChannel";


/**
 * The NEWEST migration's body for `name`, found by scanning every migration
 * newest-first, so a later `CREATE OR REPLACE` cannot leave this file grading a
 * superseded definition. Same shape as `newestBlock` in
 * src/lib/reliabilityLadder.parity.test.ts.
 */
function newestBody(name: string): { file: string; block: string } {
  const dir = resolve(process.cwd(), "supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const head = new RegExp(`^\\s*create\\s+(or\\s+replace\\s+)?function\\s+(public\\.)?"?${name}"?\\s*\\(`, "im");
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = readFileSync(resolve(dir, files[i]), "utf8");
    const start = sql.search(head);
    if (start === -1) continue;
    const tag = sql.slice(start).match(/\bAS\s+(\$[a-z_]*\$)/i);
    expect(tag, `${name} in ${files[i]} has no dollar-quoted body`).not.toBeNull();
    const open = sql.indexOf(tag![1], start);
    const end = sql.indexOf(tag![1], open + tag![1].length);
    expect(end, `${name}'s body in ${files[i]} is unterminated`).toBeGreaterThan(open);
    return { file: files[i], block: sql.slice(start, end) };
  }
  throw new Error(`no migration defines ${name}`);
}

const ME = "user-me";
const OTHER = "user-other";

describe("disputeEvidenceChannel", () => {
  const REOPENED = `${"Re-opened by an admin after the earlier decision could not be carried out:"} Helpr account deleted\n\nOriginal dispute: …`;

  it("an admin re-opened dispute (no opener, supersede's reason) is open to either party, via the RPC", () => {
    expect(disputeEvidenceChannel({ status: "open", opener_id: null, reason: REOPENED }, ME)).toBe("reopened");
    expect(disputeEvidenceChannel({ status: "open", opener_id: null, reason: REOPENED }, OTHER)).toBe("reopened");
  });

  it("no opener is NOT always an admin re-open: a deleted opener's dispute is 'unattributed', not re-opened (round-5 LOW-2)", () => {
    expect(disputeEvidenceChannel({ status: "open", opener_id: null, reason: "The work was never delivered" }, ME)).toBe("unattributed");
  });

  it("the client prefix is byte-identical to the one the NEWEST definitions write and check", () => {
    // Was: read 20260915034822 BY NAME and count occurrences of the prefix in
    // the whole file. Two things wrong with that. (1) Every one of the fourteen
    // dispute functions in that migration was reapplied by 20260915071502, so
    // it graded superseded SQL — this file was on
    // `guardsReadTheNewestMigration`'s GRANDFATHERED list for exactly that, and
    // is removed from it by this change. (2) A count of occurrences ANYWHERE in
    // a 2000-line file is a proximity assertion: it survives the prefix moving
    // out of the two functions that matter, and it never checks that the WRITER
    // and the READER agree with each other.
    //
    // Now: pull the literal out of the newest body of each function by its
    // ROLE — the string supersede CONCATENATES onto the reason, and the string
    // add_evidence tests with `position(... IN _d.reason) <> 1` — and require
    // all three to be one string.
    const writer = newestBody("rpc_supersede_dispute_decision");
    const reader = newestBody("rpc_add_dispute_evidence");

    const written = writer.block.match(/'([^']*carried out: ?)'\s*\|\|/);
    expect(written, `rpc_supersede_dispute_decision (${writer.file}) no longer builds the re-opened reason`).not.toBeNull();
    const checked = reader.block.match(/position\(\s*'([^']*)'\s+IN\s+COALESCE\(_d\.reason/i);
    expect(checked, `rpc_add_dispute_evidence (${reader.file}) no longer gates on the re-opened prefix`).not.toBeNull();

    expect(written![1].trimEnd()).toBe(REOPENED_REASON_PREFIX);
    expect(checked![1]).toBe(REOPENED_REASON_PREFIX);
    // And the reader must anchor at position 1 — a substring match anywhere in
    // the reason would let a party-written reason impersonate an admin re-open.
    expect(reader.block).toMatch(/position\(\s*'[^']*carried out:'\s+IN\s+COALESCE\(_d\.reason, ''\)\s*\)\s*<>\s*1/i);
  });

  it("a party-filed dispute stays opener-only", () => {
    expect(disputeEvidenceChannel({ status: "open", opener_id: ME, reason: "x" }, ME)).toBe("opener");
    expect(disputeEvidenceChannel({ status: "open", opener_id: OTHER, reason: "x" }, ME)).toBe("blocked");
  });

  it("nothing is added once the dispute is not open, and the legacy path is unchanged", () => {
    for (const status of ["decided", "withdrawn", "superseded"]) {
      expect(disputeEvidenceChannel({ status, opener_id: null, reason: REOPENED }, ME)).toBe("closed");
    }
    expect(disputeEvidenceChannel(null, ME)).toBe("legacy");
  });

  it("DisputeTimelineDialog routes the re-opened channel through rpc_add_dispute_evidence", () => {
    const src = readFileSync("src/components/DisputeTimelineDialog.tsx", "utf8");
    expect(src).toContain("disputeEvidenceChannel(");
    expect(src).toContain('"rpc_add_dispute_evidence"');
    // Not deployed yet (PGRST202) is told plainly, not reported as a defect.
    expect(src).toContain('"PGRST202"');
  });
});

// A NULL opener alone is not an admin re-open: a dispute whose opener DELETED
// their account is also opener_id NULL (deletion anonymises), and collapsing
// the two would hand either party a write into a dispute nobody may add to.
// @mutate src/components/disputeEvidenceChannel.ts | return isAdminReopened(dispute) ? "reopened" : "unattributed"; | return "reopened";
// The prefix check is what distinguishes them.
// @mutate src/components/disputeEvidenceChannel.ts | (dispute.reason ?? "").startsWith(REOPENED_REASON_PREFIX) | true
// A party-filed dispute stays opener-only.
// @mutate src/components/disputeEvidenceChannel.ts | return dispute.opener_id === userId ? "opener" : "blocked"; | return "opener";
