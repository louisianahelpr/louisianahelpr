/**
 * Owner 2026-11-06 (lh-money-escrow review of the "ask the tax question only where it can change the tax" fix):
 * Edit job must not keep a stale jobs.tax_kind. A Cleaning job answered "cleans carpet, rugs or furniture" and edited
 * to Yard work kept tax_kind, so create-payment / charge-recurring-visits still taxed the labor with no question on
 * screen to change it.
 *   1. moving a job to a category that does not ask (asksTaxKind) sends tax_kind NULL; to one that asks, sends nothing;
 *   2. a FUNDED taxed-by-answer job greys the non-asking categories (moving there would drop the tax and cross the
 *      line trg_funded_category_tax_class refuses) and keeps the asking ones.
 *
 * @mutate src/pages/posts/EditJobDialog.tsx |       ...(!asksTaxKind(category) && ((job as { tax_kind?: string \| null }).tax_kind ?? null) != null ? { tax_kind: null } : {}), |
 * @mutate src/pages/posts/EditJobDialog.tsx | isLaborTaxable(value, asksTaxKind(value) ? jobTaxKind : null) | isLaborTaxable(value, jobTaxKind)
 */
import { describe, it, expect, vi } from "vitest";
import { createContext, useContext, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";
import type { Job } from "../../components/job-card/activityConstants";

const writes = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@/hooks/useJobAccessNote", () => ({ useJobAccessNote: () => null, fetchJobAccessNote: async () => null }));
vi.mock("@/lib/haptics", () => ({ hapticLight: () => {}, hapticSuccess: () => {}, hapticError: () => {} }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (payload: Record<string, unknown>) => {
        writes.push(payload);
        return { eq: () => ({ select: async () => ({ data: [{ id: "j1" }], error: null }) }) };
      },
    }),
  },
}));
// Radix Select opens in a portal; a stand-in list whose items choose on click and expose their disabled state.
const Pick = createContext<(v: string) => void>(() => {});
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange }: { children: ReactNode; onValueChange?: (v: string) => void }) => (
    <Pick.Provider value={onValueChange ?? (() => {})}><div>{children}</div></Pick.Provider>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
  SelectItem: function Item({ value, disabled, children }: { value: string; disabled?: boolean; children: ReactNode }) {
    const pick = useContext(Pick);
    return <li data-value={value} aria-disabled={disabled ? "true" : "false"} onClick={() => !disabled && pick(value)}>{children}</li>;
  },
}));

// jsdom has no Element.scrollTo (the dialog scrolls its body to the top on open).
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};

const { EditJobDialog } = await import("./EditJobDialog");

const job = (over: Partial<Job> & { tax_kind?: string | null }) =>
  ({ id: "j1", title: "Sofa clean", description: "Two seats", category: "cleaning", location: "1 Main St", date_needed: jobLocalDateISO(7),
     start_time: "09:00", special_requirements: null, helper_id: null, payment_status: "unpaid", stripe_session_id: null,
     is_flexible_schedule: false, tax_kind: "fabric_cleaning", ...over }) as unknown as Job;

async function saveAfterPicking(category: string, j: Job) {
  writes.length = 0;
  const { unmount } = render(<EditJobDialog job={j} onClose={() => {}} onSaved={() => {}} />);
  fireEvent.click(document.querySelector(`li[data-value="${category}"]`)!);
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  const confirm = await screen.findAllByRole("button", { name: "Save changes" });
  fireEvent.click(confirm[confirm.length - 1]);
  await waitFor(() => expect(writes.length).toBeGreaterThan(0));
  unmount();
  return writes[0];
}

describe("Edit job never keeps a stale taxed-kind answer (owner 11-06)", () => {
  it("Cleaning + carpet answer edited to Yard work sends tax_kind NULL; to Handyman sends no tax_kind change", async () => {
    const yard = await saveAfterPicking("yard_work", job({}));
    expect(yard.category).toBe("yard_work");
    expect(yard).toHaveProperty("tax_kind", null);
    const handy = await saveAfterPicking("handyman", job({}));
    expect(handy.category).toBe("handyman");
    expect(handy).not.toHaveProperty("tax_kind");
    // A job with no answer has nothing to clear.
    const none = await saveAfterPicking("yard_work", job({ tax_kind: null }));
    expect(none).not.toHaveProperty("tax_kind");
  });

  it("a funded job taxed by its answer greys the categories that would drop the answer, and only those", () => {
    render(<EditJobDialog job={job({ payment_status: "escrow" })} onClose={() => {}} onSaved={() => {}} />);
    const disabled = new Set(Array.from(document.querySelectorAll("li[data-value]")).filter((li) => li.getAttribute("aria-disabled") === "true").map((li) => li.getAttribute("data-value")));
    // Inventory floor: most categories do not ask, so most are greyed (measured 2026-11-06).
    expect(disabled.size).toBeGreaterThan(10);
    expect(disabled.has("yard_work")).toBe(true);
    expect(disabled.has("moving")).toBe(true);
    expect(disabled.has("handyman")).toBe(false);
    expect(disabled.has("auto_repair")).toBe(false); // taxed either way
  });
});
