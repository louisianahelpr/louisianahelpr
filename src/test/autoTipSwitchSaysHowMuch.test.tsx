/**
 * F265a, tip half (audit 11-10): Jobs settings > After a job. The "Tip automatically after each job" switch did not
 * say how much it tips (the worked example sat lower down, under the chips). While the tip is on, the switch's own
 * description now leads with the amount: "Tips 15% ($23 on a $150 job)." / "Tips $5 per job.". Off says nothing.
 *
 * @mutate src/pages/profile/AutoTip.tsx | {on && example != null ? (isPercent ? | {false && example != null ? (isPercent ?
 * @mutate src/pages/profile/AutoTip.tsx | on a $150 job${cappedByMax ? ", held to your max" : ""}). ` | on a $150 job). `
 *
 * Lead, train D review: with a max set below the percent, the figure is the capped one, so the line says so
 * ("Tips 20% ($25 on a $150 job, held to your max).") instead of reading like broken arithmetic.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

let profileRow: Record<string, unknown> = {};
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn() } }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: profileRow, refresh: vi.fn() }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn(async () => {}), hapticSuccess: vi.fn(), hapticError: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

const { default: AutoTip } = await import("@/pages/profile/AutoTip");

async function description(row: Record<string, unknown>) {
  profileRow = { user_id: "u1", auto_tip_cap: null, auto_release_on_complete: false, ...row };
  render(<MemoryRouter><AutoTip onBack={() => {}} /></MemoryRouter>);
  const sw = await screen.findByRole("switch", { name: /Tip automatically/ });
  return document.getElementById(sw.getAttribute("aria-describedby") ?? "")?.textContent?.trim();
}

describe("F265a: the auto-tip switch says how much it tips", () => {
  it("percent: names the percent and what it is on a $150 job", async () => {
    expect(await description({ auto_tip_mode: "percent", auto_tip_value: 15 })).toBe(
      "Tips 15% ($23 on a $150 job). Charged after the job is finished, never before.",
    );
  });

  it("percent held by a max: says the max produced the figure", async () => {
    expect(await description({ auto_tip_mode: "percent", auto_tip_value: 20, auto_tip_cap: 25 })).toBe(
      "Tips 20% ($25 on a $150 job, held to your max). Charged after the job is finished, never before.",
    );
  });

  it("fixed: names the dollar amount per job", async () => {
    expect(await description({ auto_tip_mode: "fixed", auto_tip_value: 5 })).toBe(
      "Tips $5 per job. Charged after the job is finished, never before.",
    );
  });

  it("off: no amount is claimed", async () => {
    expect(await description({ auto_tip_mode: "off", auto_tip_value: null })).toBe("Charged after the job is finished, never before.");
  });
});
