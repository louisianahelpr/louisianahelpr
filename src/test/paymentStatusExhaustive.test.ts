/**
 * SI-013: jobs.payment_status is a text column with a CHECK, not a Postgres
 * enum, so types.ts types it as bare `string` and no Constants array exists to
 * enumerate it. PAYMENT_STATUSES (src/lib/statusLabels.ts) is the union by
 * hand; this pins it to the newest migration that defines
 * jobs_payment_status_check, so a value added in SQL without the app learning
 * it (or the reverse) fails here. The label map is Record<PaymentStatus, …>, so
 * the compiler makes it cover every member.
 *
 * @mutate src/lib/statusLabels.ts |   "cancelled", "abandoned", "failed", "chargeback", "cancelling", |   "cancelled", "abandoned", "failed", "chargeback",
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PAYMENT_STATUSES, paymentStatusLabel } from "@/lib/statusLabels";

const DIR = resolve(__dirname, "../../supabase/migrations");
const DEFINES = /ADD CONSTRAINT jobs_payment_status_check\s+CHECK\s*\(\s*payment_status\s*=\s*ANY\s*\(\s*ARRAY\[([\s\S]*?)\]/i;

function newestCheckValues(): { file: string; values: string[] } {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  let hit: { file: string; values: string[] } | null = null;
  for (const f of files) {
    const m = readFileSync(resolve(DIR, f), "utf8").match(DEFINES);
    if (m) hit = { file: f, values: [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) };
  }
  if (!hit) throw new Error("no migration defines jobs_payment_status_check");
  return hit;
}

describe("payment_status: the app's list equals the database CHECK (SI-013)", () => {
  it("PAYMENT_STATUSES is exactly the newest CHECK's value set", () => {
    const { file, values } = newestCheckValues();
    // Inventory floor: the parse must actually find the escrow state machine.
    expect(values.length, `parsed ${file}`).toBeGreaterThanOrEqual(8);
    expect([...PAYMENT_STATUSES].sort(), `vs ${file}`).toEqual([...values].sort());
  });

  it("every status has a label", () => {
    for (const s of PAYMENT_STATUSES) expect(paymentStatusLabel(s)).not.toBe("");
  });
});
