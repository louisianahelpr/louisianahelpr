/**
 * is_flexible_schedule was immutable after posting: EditJobDialog never wrote
 * it, so a poster who forgot the box had to delete and repost (OPEN.md,
 * archive L7211). The behaviour tests cover the toggle and the CHECK-shaped
 * save guard. The class test catches the next field the wizard writes that
 * the edit dialog silently drops: every key of the wizard's insert payload is
 * either in the dialog's updateData or on NOT_EDITABLE with a reason, and
 * that list is exact in both directions.
 *
 * @mutate src/pages/posts/EditJobDialog.tsx | is_flexible_schedule: isFlexible, | is_flexible_schedule: job.is_flexible_schedule ?? false,
 * @mutate src/pages/posts/EditJobDialog.tsx | if (!isFlexible && !startTime) { | if (false) {
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";
import type { Job } from "../../components/job-card/activityConstants";

const update = vi.fn();
const toastError = vi.fn();
// Q1438: the Access & Parking note is a network read once a card opens; none here.
vi.mock("@/hooks/useJobAccessNote", () => ({ useJobAccessNote: () => null, fetchJobAccessNote: async () => null }));
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
  SelectItem: ({ children }: { children: ReactNode }) => <li>{children}</li>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (data: unknown) => {
        update(data);
        return { eq: () => ({ select: async () => ({ data: [{ id: "j1" }], error: null }) }) };
      },
    }),
  },
}));

const { EditJobDialog } = await import("./EditJobDialog");

const job = (over: Partial<Job>) =>
  ({ id: "j1", title: "Shelves", description: "", category: "cleaning", location: "Baton Rouge", date_needed: jobLocalDateISO(7),
     start_time: null, special_requirements: null, helper_id: null, payment_status: "unpaid", stripe_session_id: null,
     is_flexible_schedule: false, ...over }) as unknown as Job;

const saveAndConfirm = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  const both = await screen.findAllByRole("button", { name: "Save Changes" });
  fireEvent.click(both[both.length - 1]);
};

// jsdom has no Element.scrollTo; TimePickerWheel scrolls to the set time.
Element.prototype.scrollTo = () => {};
beforeEach(() => { update.mockClear(); toastError.mockClear(); });

describe("flexible schedule is editable after posting", () => {
  it("turning Flexible on writes is_flexible_schedule: true", async () => {
    render(<EditJobDialog job={job({ start_time: "09:00" })} onClose={() => {}} onSaved={() => {}} />);
    const sw = screen.getByRole("switch", { name: "Flexible schedule" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    await saveAndConfirm();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0]).toMatchObject({ is_flexible_schedule: true });
  });

  it("turning Flexible off with no start time refuses before the server does", async () => {
    render(<EditJobDialog job={job({ is_flexible_schedule: true })} onClose={() => {}} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("switch", { name: "Flexible schedule" }));
    await saveAndConfirm();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Pick a start time, or mark the schedule as flexible."));
    expect(update).not.toHaveBeenCalled();
  });
});

// Wizard insert keys the edit dialog deliberately does not write, each with
// why. Exact: an entry that becomes editable, or stops being a wizard key,
// fails this test until it is removed here.
const NOT_EDITABLE: Record<string, string> = {
  business_id: "posting identity, fixed at post time",
  zip_code: "derived from the posted location by the wizard",
  parish: "derived from the posted location by the wizard",
  estimated_hours: "prices the job; not re-priced from this dialog",
  budget: "price; not re-priced from this dialog",
  is_recurring: "series shape; not changed from this dialog",
  recurrence_interval: "series shape; not changed from this dialog",
  recurrence_end_date: "series shape; enforce_series_columns_client_lock",
  recurrence_days: "series shape; enforce_series_columns_client_lock",
  recurrence_weeks: "series shape; enforce_series_columns_client_lock",
  series_split_ok: "series shape; enforce_series_columns_client_lock",
  is_group_job: "group shape; changes headcount and price",
  helpers_needed: "group headcount; changes price",
  is_urgent: "paid add-on (urgent_fee)",
  urgent_fee: "fee; not re-priced from this dialog",
  platform_fee_percent: "fee; not re-priced from this dialog",
  platform_fee_amount: "fee; not re-priced from this dialog",
  sales_tax_rate: "tax; not re-priced from this dialog",
  sales_tax_amount: "tax; not re-priced from this dialog",
  requires_w9: "derived from price at post time",
  credential_tier: "credential requirement, set at post time",
  department: "business department, set at post time",
  offered_to_helper_id: "direct-offer flow owns it",
  direct_offer_status: "direct-offer flow owns it",
  direct_offer_expires_at: "direct-offer flow owns it",
};

function blockKeys(src: string, start: string, end: string): string[] {
  const i = src.indexOf(start);
  expect(i, `anchor not found: ${start}`).toBeGreaterThanOrEqual(0);
  const body = src.slice(i + start.length, src.indexOf(end, i))
    .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  return [...new Set([...body.matchAll(/(?:^\s+|\{ ?|, )([a-z][a-z0-9_]*):\s/gm)].map((m) => m[1]))];
}

describe("every field the post wizard writes is editable or excused (class)", () => {
  const wizard = blockKeys(
    readFileSync(resolve(__dirname, "../post-job/jobSubmitHelpers.ts"), "utf8"),
    "  return {\n    customer_id:", "\n  };",
  );
  const edit = blockKeys(
    readFileSync(resolve(__dirname, "EditJobDialog.tsx"), "utf8"),
    'const updateData: TablesUpdate<"jobs"> = {', "\n    };",
  );

  it("reads the whole wizard payload (inventory floor)", () => {
    expect(wizard.length).toBeGreaterThanOrEqual(35); // 35 on 2026-10-02
    expect(edit).toContain("title");
  });

  it("wizard keys = updateData keys + NOT_EDITABLE, exactly", () => {
    const missing = wizard.filter((k) => !edit.includes(k) && !(k in NOT_EDITABLE));
    expect(missing, "wizard writes these but EditJobDialog drops them").toEqual([]);
    const stale = Object.keys(NOT_EDITABLE).filter((k) => !wizard.includes(k) || edit.includes(k));
    expect(stale, "NOT_EDITABLE entries that are no longer excused").toEqual([]);
  });
});
