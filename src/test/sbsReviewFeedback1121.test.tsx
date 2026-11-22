/**
 * Holiday gift guides audit 1121 (#62): the admin's Shop Small review panel names the page a listing goes to (it named
 * the retired Small Business Saturday page) and says what each Approve / Reject did, with Undo (the row used to just
 * vanish, and Approve publishes a stranger's business).
 *
 * @mutate src/pages/admin/sponsors/SbsReviewPanel.tsx |       if (v.status === "pending") return; |       return;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const calls: { fn: string; args?: Record<string, unknown> }[] = [];
const row = { id: "r1", business_name: "Cajun Candles", town: "Lafayette", category: "Gifts", deal: null, link: null, contact_email: "a@example.com", has_logo: false, status: "pending", created_at: "2026-11-21T12:00:00Z", reviewed_at: null };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve(fn === "sbs_admin_list" ? { data: [row], error: null } : { data: null, error: null });
    },
  },
}));
const toasts: { message: string; action?: { label: string; onClick: () => void } }[] = [];
vi.mock("@/lib/toast", async (orig) => ({
  ...(await orig<typeof import("@/lib/toast")>()),
  successToast: (message: string, o?: { action?: { label: string; onClick: () => void } }) => { toasts.push({ message, action: o?.action }); },
}));
import { SbsReviewPanel } from "@/pages/admin/sponsors/SbsReviewPanel";

afterEach(cleanup);

describe("Shop Small review panel (holiday audit 1121)", () => {
  it("names Shop Small, and Approve says it worked with an Undo that puts the listing back to waiting", async () => {
    const { container } = render(<QueryClientProvider client={new QueryClient()}><SbsReviewPanel /></QueryClientProvider>);
    await screen.findByText("Cajun Candles");
    expect(container.textContent).toMatch(/Shop Small/);
    expect(container.textContent).not.toMatch(/Small Business Saturday page/);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(toasts.length).toBe(1));
    expect(toasts[0].message).toMatch(/Cajun Candles/);
    expect(toasts[0].action?.label).toBe("Undo");
    toasts[0].action!.onClick();
    await waitFor(() => expect(calls.some((c) => c.fn === "sbs_admin_review" && c.args?.p_status === "pending")).toBe(true));
  });
});
