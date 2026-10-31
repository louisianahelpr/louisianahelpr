// AUD31-57: Help's "Do I need an account to browse jobs?" said posting or applying needs "a quick identity check
// through Stripe" while the identity_check switch is off (owner 2026-10-23) and the Terms say no ID is checked.
// @mutate src/pages/info/helpCenter/helpCenterContent.ts |           return identityCheckOn() |           return true
import { afterEach, describe, expect, it } from "vitest";
import { FAQ_SECTIONS } from "./helpCenterContent";
import { setIdentityCheckOn } from "@/lib/identityCheckSwitch";

const answer = () => FAQ_SECTIONS.flatMap((s) => s.items).find((i) => i.q === "Do I need an account to browse jobs?")?.a ?? "";

afterEach(() => setIdentityCheckOn(false));

describe("Help's account answer follows the identity_check switch", () => {
  it("off: no ID check is promised", () => {
    setIdentityCheckOn(false);
    expect(answer()).toMatch(/confirmed email\.$/);
    expect(answer()).not.toMatch(/identity|stripe|\bid\b/i);
  });
  it("on: the ID check is named", () => {
    setIdentityCheckOn(true);
    // Owner 2026-10-30 (ID check details): once per person, at the moments it is asked (B49, ported 10-31).
    expect(answer()).toMatch(/We ask for your ID once: when you post a job, when you're hired, or before your first payout/);
    expect(answer()).toMatch(/claim a free item or take a delivery\.$/);
  });
});
