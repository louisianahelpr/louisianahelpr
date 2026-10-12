/**
 * Q1327: the admin dispute card shows the job's EARLIER disputes, with the
 * Helpr's answer archived on each (disputes.helper_response, 20261005064816),
 * and the Helpr's answer to the current one (jobs.dispute_helper_response).
 * Before, AdminDisputes kept only the newest dispute record per job and read
 * neither answer.
 *
 * @mutate src/components/admin/adminDisputes/groupDisputeRecords.ts |     else (earlier[r.job_id] ??= []).push(r); |     else void 0;
 * @mutate src/components/admin/AdminDisputes.tsx |     setEarlierDisputes(grouped.earlier); |     setEarlierDisputes({});
 * @mutate src/components/admin/adminDisputes/EarlierDisputes.tsx |               Helpr's answer: {r.helper_response ? `"${r.helper_response}"` : "none on record"} |               Helpr's answer: none on record
 * @mutate src/components/admin/adminDisputes/DisputeCard.tsx |         <EarlierDisputes records={earlierDisputes} /> |
 * @mutate src/components/admin/AdminDisputes.tsx | execution_refund_cents, execution_error, helper_response"; | execution_refund_cents, execution_error";
 */
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EarlierDisputes } from "@/components/admin/adminDisputes/EarlierDisputes";
import { groupDisputeRecords } from "@/components/admin/adminDisputes/groupDisputeRecords";
import type { DisputeRecord } from "@/components/admin/adminDisputes/types";
import { blankComments } from "@/test/helpers/blankNonCode";

const rec = (over: Partial<DisputeRecord>): DisputeRecord => ({
  id: "d1", job_id: "j1", opener_id: "p1", reason: "Fence half painted", evidence_urls: [],
  status: "superseded", created_at: "2026-10-01T15:00:00Z", decided_at: null, decided_by: null,
  decision_text: null, payout_split: null, ...over,
});

describe("admin dispute history (Q1327)", () => {
  it("renders an earlier dispute's archived Helpr answer", () => {
    render(<EarlierDisputes records={[rec({ helper_response: "I finished; the poster changed the colour after." })]} />);
    expect(screen.getByText(/Earlier disputes on this job \(1\)/)).toBeTruthy();
    expect(screen.getByText(/the poster changed the colour after/)).toBeTruthy();
    expect(screen.getByText(/Fence half painted/)).toBeTruthy();
  });

  it("says so when an earlier dispute has no answer on record, and draws nothing with no history", () => {
    const { container, rerender } = render(<EarlierDisputes records={[rec({ helper_response: null })]} />);
    expect(screen.getByText(/none on record/)).toBeTruthy();
    rerender(<EarlierDisputes records={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  const page = blankComments(readFileSync("src/components/admin/AdminDisputes.tsx", "utf8"));
  const card = blankComments(readFileSync("src/components/admin/adminDisputes/DisputeCard.tsx", "utf8"));

  it("a re-filed job keeps its newest record current and the older ones as history", () => {
    const g = groupDisputeRecords([
      rec({ id: "old", created_at: "2026-10-01T15:00:00Z" }),
      rec({ id: "new", status: "open", created_at: "2026-10-03T15:00:00Z" }),
      rec({ id: "mid", created_at: "2026-10-02T15:00:00Z" }),
    ]);
    expect(g.current.j1.id).toBe("new");
    expect(g.earlier.j1.map((r) => r.id)).toEqual(["mid", "old"]);
  });

  it("the queue keeps every older record per job and reads both answers", () => {
    expect(page).toMatch(/setEarlierDisputes\(grouped\.earlier\);/);
    expect(page).toMatch(/execution_error, helper_response"/);
    expect((page.match(/is_seed, dispute_helper_response"\)/g) ?? []).length).toBe(2);
    expect(page).toMatch(/earlierDisputes=\{earlierDisputes\[job\.id\]\}/);
  });

  it("the card draws the history and the current answer", () => {
    expect(card).toMatch(/<EarlierDisputes records=\{earlierDisputes\} \/>/);
    expect(card).toMatch(/job\.dispute_helper_response && \(/);
  });
});
