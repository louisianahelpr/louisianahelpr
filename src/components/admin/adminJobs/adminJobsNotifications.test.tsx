import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminJobs from "../AdminJobs";

/**
 * The two things an admin job action's notification has to get right, and got
 * wrong until now.
 *
 * 1. WHERE IT LANDS. `/my-jobs` is the HELPER surface and `/my-posts` is the
 *    POSTER's, and both open on the "Needs You" bucket. Every notice addressed
 *    to the poster linked to `/my-jobs` — the other party's screen, where a job
 *    they posted cannot appear — and no fixed `?filter=` can fix that from the
 *    producer side, because the bucket a job is in keeps changing while the
 *    notification sits unread. `?job=<id>` is the shape the rest of the app was
 *    swept onto in 20260831232514_notification_links_land_on_the_right_spot.sql
 *    (see `block_user_and_settle`, which had this exact defect); Activity
 *    resolves the live bucket at open time.
 *
 * 2. WHETHER IT LANDS AT ALL. Both inserts were bare `await supabase
 *    .from("notifications").insert({...})` with the result dropped — no `error`
 *    check, and no `.select()`, so a write that touched nothing was
 *    indistinguishable from one that worked. This notification is the only
 *    signal either party gets that an admin removed or re-statused their job.
 *
 * The mock deliberately returns a bare object (no thenable) from `.insert()`
 * so that a call site which forgets `.select("id")` cannot pass this file.
 */

const JOB_ID = "job-1";
const POSTER_ID = "poster-1";
const HELPER_ID = "helper-1";

const job = {
  id: JOB_ID,
  title: "Rake and bag front-yard leaves",
  customer_id: POSTER_ID,
  helper_id: HELPER_ID,
  status: "in_progress",
  budget: 60,
  location: "Lafayette, LA",
  category: "Yard Work",
  description: "Front yard only.",
  created_at: "2026-08-29T12:00:00Z",
  date_needed: "2026-08-29",
  flag_reasons: null,
};

interface NotifyCall {
  row: Record<string, unknown>;
  selected: string | null;
}

let notifyCalls: NotifyCall[] = [];
/** What PostgREST hands back for the notification insert. */
let notifyResult: { data: unknown[] | null; error: { message: string } | null } = {
  data: [{ id: "n1" }],
  error: null,
};
let jobUpdateResult: { data: unknown[] | null; error: { message: string } | null } = {
  data: [{ id: JOB_ID }],
  error: null,
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "admin-1" } } }) },
    from: (table: string) => {
      if (table === "jobs") {
        return {
          select: () => ({ order: async () => ({ data: [job], error: null }) }),
          update: () => ({
            eq: () => ({ select: async () => jobUpdateResult }),
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            in: async () => ({
              data: [
                { user_id: POSTER_ID, full_name: "Marie Beaumont" },
                { user_id: HELPER_ID, full_name: "Eli Trahan" },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === "notifications") {
        return {
          insert: (row: Record<string, unknown>) => {
            const call: NotifyCall = { row, selected: null };
            notifyCalls.push(call);
            // NOT a thenable: awaiting this object without .select() yields the
            // object itself, which unwrapMutation rejects. That is the point.
            return {
              select: async (cols: string) => {
                call.selected = cols;
                return notifyResult;
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
    warning: vi.fn(),
    message: vi.fn(),
  },
}));

const reportMock = vi.fn();
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => reportMock(...a) }));
vi.mock("@/lib/adminAudit", () => ({ logAdminAction: vi.fn() }));
vi.mock("@/lib/biometricGate", () => ({ requireBiometric: async () => true }));

const renderAdminJobs = () =>
  render(
    <MemoryRouter initialEntries={[`/admin?view=jobs&job=${JOB_ID}`]}>
      <AdminJobs />
    </MemoryRouter>,
  );

/** Open the job, hit Remove, give a reason, confirm. */
async function removeTheJob() {
  renderAdminJobs();
  const removeBtn = await screen.findByRole("button", { name: /Remove Job/i });
  fireEvent.click(removeBtn);
  const reason = await screen.findByLabelText(/Reason for cancelling job/i);
  fireEvent.change(reason, { target: { value: "Violates community guidelines" } });
  fireEvent.click(await screen.findByRole("button", { name: /Remove & Notify/i }));
  await waitFor(() => expect(notifyCalls.length).toBe(2));
}

beforeEach(() => {
  notifyCalls = [];
  notifyResult = { data: [{ id: "n1" }], error: null };
  jobUpdateResult = { data: [{ id: JOB_ID }], error: null };
  toastError.mockReset();
  toastSuccess.mockReset();
  reportMock.mockReset();
  window.localStorage.clear();
});

describe("AdminJobs — the notification link each party gets", () => {
  it("sends the POSTER to My Posts and the HELPER to My Jobs, both carrying ?job=", async () => {
    await removeTheJob();

    const byUser = new Map(notifyCalls.map((c) => [c.row.user_id as string, c.row.link as string]));
    expect(byUser.get(POSTER_ID)).toBe(`/my-posts?job=${JOB_ID}`);
    expect(byUser.get(HELPER_ID)).toBe(`/my-jobs?job=${JOB_ID}`);
  });

  it("never writes a bare Activity surface — that opens the Needs You bucket", async () => {
    await removeTheJob();
    for (const call of notifyCalls) {
      expect(call.row.link).not.toBe("/my-jobs");
      expect(call.row.link).not.toBe("/my-posts");
      // /dashboard is Browse: it says nothing about the job that just changed.
      expect(call.row.link).not.toBe("/dashboard");
      expect(String(call.row.link)).toContain(`?job=${JOB_ID}`);
    }
  });
});

describe("AdminJobs — the notification insert cannot fail silently", () => {
  it('asks for the affected rows back with .select("id")', async () => {
    await removeTheJob();
    expect(notifyCalls.map((c) => c.selected)).toEqual(["id", "id"]);
  });

  it("surfaces a PostgREST error instead of dropping it", async () => {
    notifyResult = { data: null, error: { message: "permission denied for table notifications" } };
    await removeTheJob();

    expect(toastError).toHaveBeenCalled();
    // A transport/permission failure is not a WriteRejectedError, so this call
    // site is what puts it in error_logs.
    expect(reportMock).toHaveBeenCalled();
  });

  it("surfaces the SILENT one: error === null with zero rows written", async () => {
    notifyResult = { data: [], error: null };
    await removeTheJob();

    expect(toastError).toHaveBeenCalled();
    const said = toastError.mock.calls.flat().join(" ");
    expect(said).toMatch(/could not be notified|couldn't be notified/i);
  });

  it("still completes the removal when the notify fails — the job change already landed", async () => {
    notifyResult = { data: [], error: null };
    await removeTheJob();

    // Both parties were attempted; the first failure did not abort the second.
    expect(notifyCalls).toHaveLength(2);
  });
});
