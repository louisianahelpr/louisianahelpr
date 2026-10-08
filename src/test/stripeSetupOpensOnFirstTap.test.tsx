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
    render(<AwardGateDialog open onOpenChange={onOpenChange} reason="helper_identity_unverified" pendingMissing={["stripe_id"]} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /finish stripe setup/i })); });
    expect(calls).toEqual(["open"]);
  });
});
