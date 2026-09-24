/**
 * Broadcasts was removed by the owner on 2026-09-01 (S-004, MQ19 2026-09-24),
 * but its banner still ran two reads on every Dashboard load and Admin could
 * still create banners. No client code reads or writes the broadcast tables,
 * and /admin has no Broadcasts view. Migration 20260924174847 drops both tables,
 * the fan-out functions and the cron that ran them.
 */
// @mutate src/pages/Dashboard.tsx | import GiftCardTeaser from "@/components/dashboard/GiftCardTeaser"; | import GiftCardTeaser from "@/components/dashboard/GiftCardTeaser"; void supabase.from("broadcasts").select("id");
// @mutate src/components/admin/adminNavGroups.tsx | { id: "notifications", label: "Notifications", icon: BellRing }, | { id: "broadcasts", label: "Broadcasts", icon: BellRing }, { id: "notifications", label: "Notifications", icon: BellRing },
// @mutate supabase/migrations/20260924174847_drop_broadcasts_feature.sql | DROP TABLE IF EXISTS public.broadcast_messages; | SELECT 1;
// @mutate supabase/migrations/20260924174847_drop_broadcasts_feature.sql | PERFORM cron.unschedule('sweep-pending-broadcast-fan-outs'); | PERFORM 1;
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "test" || n === "integrations" ? [] : files(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("Broadcasts stays removed", () => {
  const all = files(SRC);

  it("scans the app source (the inventory is not empty)", () => {
    expect(all.length).toBeGreaterThan(300);
  });

  it("no app code touches the broadcasts or broadcast_dismissals tables", () => {
    const hits = all.filter((p) => /from\(\s*["'](broadcasts|broadcast_dismissals)["']/.test(readFileSync(p, "utf8")));
    expect(hits.map((p) => p.slice(SRC.length + 1))).toEqual([]);
  });

  it("the admin menu has no Broadcasts entry", () => {
    const nav = readFileSync(join(SRC, "components/admin/adminNavGroups.tsx"), "utf8");
    expect(nav).not.toMatch(/id:\s*"broadcasts"/);
  });

  it("a migration drops both tables, the fan-out functions and their cron", () => {
    const sql = readFileSync(join(SRC, "..", "supabase/migrations/20260924174847_drop_broadcasts_feature.sql"), "utf8");
    for (const t of ["broadcast_dismissals", "broadcast_messages"]) expect(sql).toContain(`DROP TABLE IF EXISTS public.${t};`);
    for (const f of ["sweep_pending_broadcast_fan_outs()", "fan_out_broadcast_to_notifications(uuid)", "set_broadcast_pending_fan_out()"]) {
      expect(sql).toContain(`DROP FUNCTION IF EXISTS public.${f};`);
    }
    expect(sql).toContain("PERFORM cron.unschedule('sweep-pending-broadcast-fan-outs');");
  });
});
