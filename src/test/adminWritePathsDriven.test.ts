/*
 * CLASS GUARD (Q226): every ADMIN money / account write path is driven by a
 * journey or registered uncovered with its reason — in both directions — and
 * every admin money action is shown to REFUSE a non-admin on the real backend.
 *
 * The instance: no journey drove an admin refund (Quick Refund /
 * admin_refund_general) or the ban gate on writes; the gate was unit-tested
 * only (src/test/applyErrorCodeCoverage.test.ts).
 *
 * The inventory is DERIVED FROM SOURCE, comments blanked:
 *   - every `action === "admin_…"` branch in supabase/functions/create-payment,
 *   - every `action === '…'` branch in supabase/functions/admin-user-actions,
 *   - supabase/functions/execute-dispute-split (one admin-decision door),
 *   - `enforce_ban_gate`, the trigger function that is the ban gate on writes,
 *     when the migrations define it.
 */
// @mutate e2e/journeys/04-money-outcomes.spec.ts | const NON_ADMIN_REFUSED = ["admin_refund_general", "admin_refund_dispute", "admin_release_dispute"] as const; | const NON_ADMIN_REFUSED = ["admin_refund_general", "admin_refund_dispute"] as const;
// @mutate e2e/journeys/04-money-outcomes.spec.ts | { action: "admin_refund_general", jobId, reason: | { action: "admin_refund_dispute", jobId, reason:
// @mutate e2e/journeys/adminWritePaths.ts |   "admin-user-actions:set_ban_status": { success: { uncovered: SHARED_TARGET } },\n |
// @mutate e2e/journeys/04-money-outcomes.spec.ts |     for (const p of uncoveredAdminPaths()) { |     for (const p of [] as ReturnType<typeof uncoveredAdminPaths>) {
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ADMIN_WRITE_PATHS } from "../../e2e/journeys/adminWritePaths";
import { blankComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = resolve(__dirname, "..", "..");
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));
const MONEY = "e2e/journeys/04-money-outcomes.spec.ts";

function adminWriteInventory(): string[] {
  const out = new Set<string>();
  for (const m of code("supabase/functions/create-payment/index.ts").matchAll(/\baction\s*===\s*["'](admin_\w+)["']/g)) {
    out.add(`create-payment:${m[1]}`);
  }
  for (const m of code("supabase/functions/admin-user-actions/index.ts").matchAll(/\baction\s*===\s*["'](\w+)["']/g)) {
    out.add(`admin-user-actions:${m[1]}`);
  }
  if (existsSync(join(ROOT, "supabase/functions/execute-dispute-split/index.ts"))) out.add("execute-dispute-split");
  if (effectiveDefs(join(ROOT, "supabase", "migrations")).has("enforce_ban_gate")) out.add("sql:enforce_ban_gate");
  return [...out].sort();
}

describe("every admin money/account write path is driven or annotated uncovered (Q226)", () => {
  const inventory = adminWriteInventory();

  it("derives a real inventory from source (cannot pass vacuously)", () => {
    // 2026-09-26: 3 create-payment admin actions, 9 admin-user-actions actions,
    // execute-dispute-split, enforce_ban_gate = 14.
    expect(inventory.length).toBeGreaterThan(12);
    expect(inventory).toContain("create-payment:admin_refund_general");
    expect(inventory).toContain("admin-user-actions:set_ban_status");
    expect(inventory).toContain("sql:enforce_ban_gate");
  });

  it("every path has an entry, and every entry is still a path (two-way)", () => {
    const missing = inventory.filter((p) => !(p in ADMIN_WRITE_PATHS));
    expect(missing, "admin write paths with no entry in e2e/journeys/adminWritePaths.ts:\n  " + missing.join("\n  ")).toEqual([]);
    const stale = Object.keys(ADMIN_WRITE_PATHS).filter((p) => !inventory.includes(p));
    expect(stale, "entries for admin paths that no longer exist — remove them").toEqual([]);
  });

  it("the Quick Refund success is driven, and every create-payment admin action's non-admin refusal is driven", () => {
    const qr = ADMIN_WRITE_PATHS["create-payment:admin_refund_general"];
    expect(qr && "driven" in qr.success, "admin_refund_general's success must be driven (Q226)").toBe(true);
    for (const p of inventory.filter((x) => x.startsWith("create-payment:"))) {
      const r = ADMIN_WRITE_PATHS[p]?.refusal;
      expect(r && "driven" in r, `${p}: a non-admin's refusal needs no admin and no third account — drive it`).toBe(true);
    }
    // The refusal loop really covers every create-payment admin action, both ways.
    const m = /const NON_ADMIN_REFUSED = \[([^\]]*)\] as const;/.exec(code(MONEY));
    expect(m, `${MONEY} no longer declares NON_ADMIN_REFUSED`).not.toBeNull();
    const looped = [...m![1].matchAll(/"(\w+)"/g)].map((x) => `create-payment:${x[1]}`).sort();
    expect(looped).toEqual(inventory.filter((x) => x.startsWith("create-payment:")));
  });

  it("a driven half's spec is a journey and contains its evidence; an uncovered half has a real reason", () => {
    const bad: string[] = [];
    for (const [path, p] of Object.entries(ADMIN_WRITE_PATHS)) {
      for (const [half, c] of [["success", p.success], ["refusal", p.refusal]] as const) {
        if (!c) continue;
        if ("driven" in c) {
          if (!c.driven.spec.startsWith("e2e/journeys/") || !existsSync(join(ROOT, c.driven.spec))) bad.push(`${path} ${half}: ${c.driven.spec} is not a journey spec`);
          else if (!code(c.driven.spec).includes(c.driven.evidence)) bad.push(`${path} ${half}: ${c.driven.spec} no longer contains ${c.driven.evidence}`);
        } else if (c.uncovered.length < 40) bad.push(`${path} ${half}: reason too thin`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the money-outcomes journey announces every uncovered admin path", () => {
    expect(code(MONEY), `${MONEY} no longer annotates uncoveredAdminPaths()`).toMatch(/for \(const p of uncoveredAdminPaths\(\)\) \{\s*test\.info\(\)\.annotations\.push\(\{ type: "uncovered"/);
  });
});
