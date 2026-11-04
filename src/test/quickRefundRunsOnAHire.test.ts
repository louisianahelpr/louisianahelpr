/**
 * THE QUICK REFUND SUCCESS LEG RUNS ON A HIRE, NOT A SKIP (Q2445; finding lh-silent-failure@b0efb428d3#6).
 *
 * With card_hold_at_post an open job only HOLDS the card, so 04-money-outcomes' admin-quick-refund leg used to
 * assert the refusal on the hold and then skip its success half as "justified". A refund of captured money
 * needs a hire: the leg now hires on the held card (apply, accept, the Helpr's Accept = capture_hold), checks
 * the charge landed (escrow), and runs the Quick Refund success on it. This guard keeps the hire and keeps the
 * skip and its allowlist entry gone.
 *
 * @mutate e2e/journeys/04-money-outcomes.spec.ts |       await hireOnHeldCard(request, poster, helper, jobId);\n |
 * @mutate e2e/journeys/04-money-outcomes.spec.ts | expect(await captureHeldCard(api, helper, jobId), "the Helpr's Accept did not charge the held card").toBe("accepted"); | await Promise.resolve();
 * @mutate e2e/journeys/04-admin-safety.spec.ts |       await hireOnHeldCard(request, poster, helpr, jobId);\n |
 * @mutate e2e/journeys/04-admin-safety.spec.ts | toEqual([runningStatus, "escrow"]); | toEqual(["open", "escrow"]);
 * @mutate e2e/journeys/04-money-outcomes.spec.ts |       expect(hired.payment_status, "the Helpr's Accept did not charge the held card").toBe("escrow");\n |       test.skip(true, `Quick Refund success not driven on a held card: ${jobId}`);\n
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const src = blankComments(readFileSync(join(process.cwd(), "e2e/journeys/04-money-outcomes.spec.ts"), "utf8"));
const allow = blankComments(readFileSync(join(process.cwd(), "e2e/skipAllowlist.ts"), "utf8"));
const start = src.indexOf('titleFor("admin-quick-refund", "refunded")');
const leg = src.slice(start, src.indexOf('titleFor("hire-settle-tip"', start) > 0 ? src.indexOf('titleFor("hire-settle-tip"', start) : undefined);
const hire = src.slice(src.indexOf("async function hireOnHeldCard("), src.indexOf("async function unwind("));

const safety = blankComments(readFileSync(join(process.cwd(), "e2e/journeys/04-admin-safety.spec.ts"), "utf8"));
const j9 = safety.slice(safety.indexOf('title("admin-refund", "refunded", "admin", "approved")'), safety.indexOf('title("ban-enforcement"') > 0 ? safety.indexOf('title("ban-enforcement"') : undefined);

describe("Quick Refund success runs on a hire (Q2445)", () => {
  it("the admin refund UI journey (J9) hires on a held card and runs its refund steps on the hired status", () => {
    expect(j9.length).toBeGreaterThan(2000);
    const held = j9.slice(j9.indexOf('=== "held") {'));
    expect(held).toContain("await hireOnHeldCard(request, poster, helpr, jobId);");
    expect(held).toContain('.toBe("escrow");');
    expect(held).toContain("runningStatus = hired.status;");
    expect(j9).toContain('toEqual([runningStatus, "escrow"]);');
    expect(j9).not.toMatch(/test\.skip\(true/);
    expect(safety).toContain('expect(await captureHeldCard(api, helper, jobId), "the Helpr\'s Accept did not charge the held card").toBe("accepted");');
  });

  it("finds the leg and the hire helper (inventory floor)", () => {
    expect(start).toBeGreaterThan(0);
    expect(leg.length).toBeGreaterThan(1500);
    expect(hire.length).toBeGreaterThan(500);
  });

  it("on a held card the leg hires, checks the charge, and refunds it; it never skips", () => {
    const held = leg.slice(leg.indexOf('if (untouched.payment_status === "held")'));
    expect(held).toContain("await hireOnHeldCard(request, poster, helper, jobId);");
    expect(held).toContain('.toBe("escrow");');
    expect(held).toMatch(/refund = await invoke\(request, admin, "create-payment", \{ jobId, action: "admin_refund_general"/);
    expect(leg).not.toMatch(/test\.skip\(true/);
  });

  it("the hire goes through apply, accept and the Helpr's Accept (capture_hold)", () => {
    expect(hire).toContain("/rest/v1/rpc/apply_to_job");
    expect(hire).toContain("/rest/v1/rpc/accept_application");
    expect(hire).toContain('expect(await captureHeldCard(api, helper, jobId), "the Helpr\'s Accept did not charge the held card").toBe("accepted");');
  });

  it("the Quick Refund held-card skip is gone from the allowlist", () => {
    expect(allow.length).toBeGreaterThan(1000);
    expect(allow).not.toContain("Quick Refund success not driven on a held card");
    expect(allow).not.toContain("Admin refund UI not driven on a held card");
  });
});
