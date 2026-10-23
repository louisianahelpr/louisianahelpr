/**
 * Owner, 2026-10-08: "when I click accept I have to click Finish Stripe Setup
 * twice, the first time it just closed it and the second it took me to
 * Stripe." The gate dialog closed itself BEFORE sending the browser to
 * Stripe, so the page's close handlers ran while that move started. It now
 * opens Stripe first; on the web it never closes itself (the page leaves).
 *
 * @mutate src/components/AwardGateDialog.tsx |       await openExternalUrl(data.url);\n      if (isNativePlatform) {\n        onOpenChange(false); |       onOpenChange(false);\n      await openExternalUrl(data.url);\n      if (isNativePlatform) {
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
// Payout setup OPEN here (owner pause of 2026-10-23 is the `payout_setup` switch):
// this file tests the setup flow itself; the paused state is
// src/components/payouts/payoutSetupPaused.test.tsx.
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => false }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn(async () => ({ data: { url: "https://connect.stripe.com/setup/x" }, error: null })) } },
}));
vi.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: vi.fn(async () => { calls.push("open"); }) }));
vi.mock("@/lib/analytics", () => ({ track: () => {}, AhaEvent: {} }));

import { AwardGateDialog } from "@/components/AwardGateDialog";

describe("Finish Stripe Setup goes to Stripe on the first tap", () => {
  beforeEach(() => { calls.length = 0; });

  it("opens Stripe before anything closes, and the web dialog does not close itself", async () => {
    const onOpenChange = vi.fn((o: boolean) => { calls.push(`close:${o}`); });
    render(<AwardGateDialog open onOpenChange={onOpenChange} reason="helper_payout_setup_incomplete" pendingMissing={["payout_setup", "stripe_id"]} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /set up payouts/i })); });
    expect(calls).toEqual(["open"]);
  });

  it("with payouts done, the one CTA opens the Stripe Identity sheet, never a Connect link (owner 2026-10-21)", async () => {
    const onOpenChange = vi.fn((o: boolean) => { calls.push(`close:${o}`); });
    const { useIdentityCheckSheet } = await import("@/lib/identityCheck");
    let sheet = { open: false };
    function Probe() { sheet = useIdentityCheckSheet(); return null; }
    render(<><AwardGateDialog open onOpenChange={onOpenChange} reason="helper_identity_unverified" pendingMissing={["stripe_id"]} /><Probe /></>);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /verify my id/i })); });
    expect(calls).toEqual(["close:false"]);
    expect(sheet.open).toBe(true);
  });
});
