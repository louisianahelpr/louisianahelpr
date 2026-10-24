/**
 * CLASS GUARD (PayPal Plan A, shared webhook contract 2026-10-23): one PayPal event type has ONE
 * handler. Each phase owns one handler file under supabase/functions/_shared/payments/webhook/ and
 * buildDispatchTable() throws AT LOAD if two files claim the same event type, which would take the
 * whole paypal-webhook down (every delivery 5xx, PayPal stops retrying after 3 days). This catches
 * the clash in CI instead, from the files themselves.
 *
 * Inventory DERIVED: every `webhook/*Events.ts` file; each must export one `*_EVENT_HANDLERS` table
 * that webhookHandlers.ts imports into SOURCES, and no event-type key may appear in two files.
 *
 * @mutate supabase/functions/_shared/payments/webhook/refundEvents.ts |   "PAYMENT.REFUND.PENDING": handleRefundEvent, |   "PAYMENT.REFUND.PENDING": handleRefundEvent,\n  "PAYMENT.REFUND.PENDING": handleRefundEvent,
 * @mutate supabase/functions/_shared/payments/webhookHandlers.ts |   ["refundEvents", REFUND_EVENT_HANDLERS], |   ["refundEvents", {}],
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const DIR = path.resolve(__dirname, "../../supabase/functions/_shared/payments/webhook");
const DISPATCH = path.resolve(__dirname, "../../supabase/functions/_shared/payments/webhookHandlers.ts");

function handlerFiles(): string[] {
  return readdirSync(DIR).filter((f) => /Events\.ts$/.test(f)).sort();
}

/** The event-type keys of a file's exported handler table. */
function keysOf(src: string): { table: string | null; keys: string[] } {
  const m = /export const ([A-Z_]+_EVENT_HANDLERS): PayPalEventHandlers = \{([\s\S]*?)\};/.exec(src);
  if (!m) return { table: null, keys: [] };
  return { table: m[1], keys: [...m[2].matchAll(/"([A-Z][A-Z0-9_.-]+)"\s*:/g)].map((k) => k[1]) };
}

describe("PayPal webhook handler files never claim the same event type", () => {
  const files = handlerFiles();

  it("inventory: the four phase files exist and each exports one handler table", () => {
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) expect(keysOf(blankComments(readFileSync(path.join(DIR, f), "utf8"))).table, f).toBeTruthy();
  });

  it("every handler table is wired into the dispatch table", () => {
    const dispatch = blankComments(readFileSync(DISPATCH, "utf8"));
    for (const f of files) {
      const { table } = keysOf(blankComments(readFileSync(path.join(DIR, f), "utf8")));
      expect(dispatch, `${f} -> ${table}`).toContain(`["${f.replace(/\.ts$/, "")}", ${table}]`);
    }
  });

  it("no event type is claimed twice (within a file or across files)", () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const f of files) {
      for (const k of keysOf(blankComments(readFileSync(path.join(DIR, f), "utf8"))).keys) {
        if (owner.has(k)) clashes.push(`${k}: ${owner.get(k)} and ${f}`);
        owner.set(k, f);
      }
    }
    expect(clashes).toEqual([]);
    // Phase 5 owns the refund events (shared contract): a phase-3 wildcard list must not take them.
    expect(owner.get("PAYMENT.CAPTURE.REFUNDED")).toBe("refundEvents.ts");
  });
});
