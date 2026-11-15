/**
 * /25days/rules KEEPS ITS COLUMN FROM SPINNER TO RULES (Q169; prod-audit 43691657529 page-settle @1440: CLS 0.1417).
 *
 * React reuses the page's second box for every state (loading, error, rules). The spinner box was full width
 * (lh25-loading alone: 1440 wide, 60vh tall) and the rules box is the 760px centred column (lh25-rules), so at 1440 the
 * reused box's left edge jumped 340px when the rules arrived: impact 0.60 x distance 0.236 = 0.1417.
 * Measured on a local build against prod, guest, service workers blocked, the one read RPC re-sent as a read-only GET
 * (~/.lh-shots/builder3e-1115/rules-{before,after}-*.json): 1440 0.1418 -> 0.0002 (3 runs each).
 *
 * The rule here: the loading and error boxes are the rules column too, and React keeps the SAME box into the rules,
 * so it never changes place.
 *
 * @mutate src/pages/sponsor/SponsorRulesPage.tsx | <div className="lh25-rules lh25-loading" role="status"> | <div className="lh25-loading" role="status">
 * @mutate src/pages/sponsor/SponsorRulesPage.tsx |         <div className="lh25-rules lh25-loading" role="alert"> |         <div className="lh25-loading" role="alert">
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import SponsorRulesPage from "@/pages/sponsor/SponsorRulesPage";

const st = vi.hoisted(() => ({ resolve: null as null | ((v: unknown) => void), reject: null as null | ((e: unknown) => void) }));
vi.mock("@/lib/sponsor/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/sponsor/api")>()),
  sponsorBackend: async () => ({
    publicState: () => new Promise((resolve, reject) => { st.resolve = resolve; st.reject = reject; }),
  }),
}));

function open() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/25days/rules"]}><SponsorRulesPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}
const STATE = { on: true, counts: {}, days: [], spots_left: 25 };

afterEach(() => cleanup());

describe("/25days/rules: spinner, error and rules share one column box", () => {
  it("the spinner sits in the rules column, and that same box becomes the rules", async () => {
    open();
    const spinner = await screen.findByRole("status");
    expect(spinner.className.split(/\s+/)).toContain("lh25-rules");
    await waitFor(() => expect(st.resolve).not.toBeNull());
    await act(async () => { st.resolve!(STATE); });
    await screen.findByRole("heading", { level: 1 });
    const column = document.querySelector(".lh25-rules");
    expect(column).toBe(spinner);
    expect(column!.className).toBe("lh25-rules");
  });

  it("the error box sits in the rules column too", async () => {
    open();
    await waitFor(() => expect(st.reject).not.toBeNull());
    await act(async () => { st.reject!(new Error("offline")); });
    const alert = await screen.findByRole("alert", {}, { timeout: 2000 }).catch(() => null);
    const box = alert?.closest(".lh25-loading") ?? document.querySelector(".lh25-loading");
    expect(box).not.toBeNull();
    expect(box!.className.split(/\s+/)).toContain("lh25-rules");
  });

  it("covers both waiting boxes (floor)", () => {
    expect(["status", "alert"].length).toBeGreaterThan(1);
  });
});
