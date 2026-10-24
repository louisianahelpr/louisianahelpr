/**
 * PayPal phase 6: VAULT.PAYMENT-TOKEN.DELETED retires the saved method at once (only the active
 * one, only in this env), is idempotent, and asks PayPal to redeliver when the database fails.
 * The handler is registered in the dispatch table (webhookHandlers.ts SOURCES).
 *
 * @mutate supabase/functions/_shared/payments/vaultTokenDeleted.ts | .eq("env", env) | .eq("env", env === "live" ? "sandbox" : "live")
 * @mutate supabase/functions/_shared/payments/vaultTokenDeleted.ts | if (error) return { kind: "retry", note: `saved method revoke failed: ${error.message}` }; | if (error) return { kind: "done", note: "ok" };
 * @mutate supabase/functions/_shared/payments/webhookHandlers.ts | ["vaultEvents", VAULT_EVENT_HANDLERS], | ["vaultEventsX", {}],
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { revokeDeletedVaultToken, vaultTokenIdOf } from "../../supabase/functions/_shared/payments/vaultTokenDeleted.ts";
import { blankComments } from "./helpers/blankNonCode";

type Filter = [string, unknown];
function fakeDb(answer: { rows?: Array<{ id: string }>; error?: { message: string } }) {
  const calls: Array<{ table: string; patch: Record<string, unknown>; filters: Filter[] }> = [];
  const db = {
    from(table: string) {
      const call = { table, patch: {} as Record<string, unknown>, filters: [] as Filter[] };
      calls.push(call);
      const chain = {
        update(p: Record<string, unknown>) { call.patch = p; return chain; },
        eq(c: string, v: unknown) { call.filters.push([c, v]); return chain; },
        select() { return Promise.resolve({ data: answer.error ? null : answer.rows ?? [], error: answer.error ?? null }); },
      };
      return chain;
    },
  };
  return { db, calls };
}
const EVENT = { id: "WH-1", event_type: "VAULT.PAYMENT-TOKEN.DELETED", resource: { id: "6pa37340nx108405w" } };
const NOW = () => new Date("2026-10-23T12:00:00Z");

describe("VAULT.PAYMENT-TOKEN.DELETED", () => {
  it("revokes the ACTIVE saved method with that token, in this env only", async () => {
    const { db, calls } = fakeDb({ rows: [{ id: "m1" }] });
    expect(await revokeDeletedVaultToken(db, "sandbox", EVENT, NOW)).toEqual({ kind: "done", note: "revoked saved method for token 6pa37340nx108405w" });
    expect(calls).toEqual([{
      table: "paypal_saved_payment_methods",
      patch: { status: "revoked", revoked_at: "2026-10-23T12:00:00.000Z" },
      filters: [["env", "sandbox"], ["vault_id", "6pa37340nx108405w"], ["status", "active"]],
    }]);
  });
  it("a token already revoked or never saved here: done, nothing to redeliver", async () => {
    const { db } = fakeDb({ rows: [] });
    expect((await revokeDeletedVaultToken(db, "sandbox", EVENT, NOW)).kind).toBe("done");
  });
  it("a database failure asks PayPal to redeliver (never marked done)", async () => {
    const { db } = fakeDb({ error: { message: "down" } });
    expect(await revokeDeletedVaultToken(db, "sandbox", EVENT, NOW)).toEqual({ kind: "retry", note: "saved method revoke failed: down" });
  });
  it("no usable token id: final, and nothing is written", async () => {
    for (const payload of [{}, { resource: {} }, { resource: { id: "x'; drop" } }, null]) {
      const { db, calls } = fakeDb({ rows: [] });
      expect((await revokeDeletedVaultToken(db, "sandbox", payload, NOW)).kind).toBe("final");
      expect(calls).toEqual([]);
    }
    expect(vaultTokenIdOf(EVENT)).toBe("6pa37340nx108405w");
  });
  it("is wired: the dispatch table sources phase 6's vault handlers, which own VAULT.PAYMENT-TOKEN.DELETED", () => {
    const root = path.resolve(__dirname, "../..");
    const table = blankComments(readFileSync(path.join(root, "supabase/functions/_shared/payments/webhookHandlers.ts"), "utf8"));
    expect(table).toContain('["vaultEvents", VAULT_EVENT_HANDLERS]');
    const handlers = blankComments(readFileSync(path.join(root, "supabase/functions/_shared/payments/webhook/vaultEvents.ts"), "utf8"));
    expect(handlers).toContain('"VAULT.PAYMENT-TOKEN.DELETED": async');
    expect(handlers).toContain("revokeDeletedVaultToken(ctx.supabase, ctx.env, event.payload)");
  });
});
