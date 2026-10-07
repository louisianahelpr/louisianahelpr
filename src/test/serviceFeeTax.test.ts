/**
 * Q1490 (owner, 2026-10-07): a refund keeps the tax charged on the kept
 * service fee. supabase/functions/_shared/serviceFeeTax.ts reads it from the
 * Checkout Session's "Service fee" line; exempt, no session -> 0; unreadable ->
 * null (the caller then refunds it, the poster-favourable side).
 *
 * @mutate supabase/functions/_shared/serviceFeeTax.ts |     if (!line) return null; |     if (!line) return 0;
 * @mutate supabase/functions/_shared/serviceFeeTax.ts |   if (!sessionId \|\| !isLaborTaxable(category)) return 0; |   if (!sessionId) return 0;
 */
import { describe, it, expect, vi } from "vitest";
import { serviceFeeTaxCents } from "../../supabase/functions/_shared/serviceFeeTax";

const stripeWith = (impl: () => Promise<unknown>) => ({ checkout: { sessions: { listLineItems: vi.fn(impl) } } }) as never;

describe("serviceFeeTaxCents (Q1490)", () => {
  it("reads the Service fee line's amount_tax on a taxable job", async () => {
    const s = stripeWith(async () => ({ data: [{ description: "Helpr Job: x", amount_tax: 1000 }, { description: "Service fee", amount_tax: 120 }] }));
    expect(await serviceFeeTaxCents(s, "cs_1", "assembly")).toBe(120);
  });
  it("is 0 on an exempt category or with no session, without asking Stripe", async () => {
    const s = stripeWith(async () => ({ data: [{ description: "Service fee", amount_tax: 120 }] }));
    expect(await serviceFeeTaxCents(s, "cs_1", "cleaning")).toBe(0);
    expect(await serviceFeeTaxCents(s, null, "assembly")).toBe(0);
    expect((s as unknown as { checkout: { sessions: { listLineItems: ReturnType<typeof vi.fn> } } }).checkout.sessions.listLineItems).not.toHaveBeenCalled();
  });
  it("a session paid before the fee was taxed (no tax on the line) is 0; an unreadable one is null", async () => {
    expect(await serviceFeeTaxCents(stripeWith(async () => ({ data: [{ description: "Service fee", amount_tax: 0 }] })), "cs_1", "handyman")).toBe(0);
    // No Service fee line on a taxable session is unknown, never a silent 0 (review).
    expect(await serviceFeeTaxCents(stripeWith(async () => ({ data: [{ description: "Helpr Job: x", amount_tax: 900 }] })), "cs_1", "handyman")).toBeNull();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await serviceFeeTaxCents(stripeWith(async () => { throw new Error("stripe down"); }), "cs_1", "handyman")).toBeNull();
    warn.mockRestore();
  });
});
