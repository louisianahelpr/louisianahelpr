/**
 * App audit 11-23 HA-08: Admin Reports titled a job review report "Deleted account — retaliation" and greyed out
 * Message Reported. A 'review' report holds the review's id (ReviewsSection) and a 'message' report the message's id
 * (Messages); the queue looked each up as a person. It now names the review's writer / the message's sender and the
 * job, and Message Reported reaches that person.
 *
 * @mutate src/components/admin/adminReports/fetchReports.ts |       if (isJobWordsReport(r.reported_type)) return jobWordsSubject( |       if (false) return jobWordsSubject(
 * @mutate src/components/admin/adminReports/fetchReports.ts |       : isJobWordsReport(r.reported_type) ? jobWords.get(r.reported_id)?.author ?? null\n |
 * @mutate src/components/admin/adminReports/reportedJobWords.ts |     for (const r of data ?? []) words.set(r.id, { author: r.reviewer_id ?? null, | for (const r of data ?? []) words.set(r.id, { author: r.id,
 */
import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  reports: [
    { id: "rp1", reported_type: "review", reported_id: "rev-1", reporter_id: "u-reporter", assigned_to: null, status: "pending", reason: "retaliation", description: null, created_at: "2026-11-20T00:00:00Z" },
    { id: "rp2", reported_type: "message", reported_id: "msg-1", reporter_id: "u-reporter", assigned_to: null, status: "pending", reason: "harassment", description: null, created_at: "2026-11-21T00:00:00Z" },
    { id: "rp3", reported_type: "review", reported_id: "rev-gone", reporter_id: "u-reporter", assigned_to: null, status: "pending", reason: "spam", description: null, created_at: "2026-11-22T00:00:00Z" },
  ],
  tables: {
    reviews: [{ id: "rev-1", reviewer_id: "u-writer", job_id: "job-1", rating: 1 }],
    messages: [{ id: "msg-1", sender_id: "u-sender", job_id: "job-1" }],
    jobs: [{ id: "job-1", title: "Fence repair", is_seed: false }],
    profiles: [
      { user_id: "u-reporter", full_name: "Rita Reporter", is_seed: false },
      { user_id: "u-writer", full_name: "Wade Writer", is_seed: false },
      { user_id: "u-sender", full_name: "Sam Sender", is_seed: false },
    ],
  } as Record<string, Record<string, unknown>[]>,
}));

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let rows: Record<string, unknown>[] = table === "reports" ? db.reports : db.tables[table] ?? [];
    const q = {
      select: () => q,
      neq: () => q,
      eq: () => q,
      order: () => q,
      in: (col: string, vals: unknown[]) => {
        if (table !== "reports") rows = rows.filter((r) => vals.includes(r[col]));
        return q;
      },
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok),
    };
    return q;
  };
  return { supabase: { from, rpc: async () => ({ data: [], error: null }) } };
});

import { fetchReports } from "@/components/admin/adminReports/fetchReports";

describe("HA-08: job review and message reports name their writer", () => {
  it("a review report names the reviewer and the job; Message reaches them", async () => {
    const rows = await fetchReports("all");
    expect(rows.length).toBeGreaterThan(2);
    const review = rows.find((r) => r.id === "rp1")!;
    expect(review.reported_name).toBe('Wade W. · review (1 star) on "Fence repair"');
    expect(review.subject_user_id).toBe("u-writer");
    expect(review.reported_exists).toBe(true);
  });

  it("a message report names the sender", async () => {
    const msg = (await fetchReports("all")).find((r) => r.id === "rp2")!;
    expect(msg.reported_name).toBe('Sam S. · message on "Fence repair"');
    expect(msg.subject_user_id).toBe("u-sender");
    expect(msg.reported_exists).toBe(true);
  });

  it("a removed review says Deleted review, never Deleted account", async () => {
    const gone = (await fetchReports("all")).find((r) => r.id === "rp3")!;
    expect(gone.reported_name).toBe("Deleted review");
    expect(gone.reported_exists).toBe(false);
  });
});
