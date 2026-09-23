// @mutate src/components/admin/adminUserHelpers.tsx | if (s === "pending" || s === "processing") { | if (false) {
/*
 * CLASS CHECK: every Stripe Identity state gets its own honest admin badge.
 *
 * Users never send an ID to us — Stripe Identity collects it (owner,
 * 2026-09-23). Until then, anyone Stripe was mid-check on (idv_status
 * pending/processing) read "ID Not Submitted" in admin People. The statuses
 * come from the constraint's migration text, so one added later is walked too.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { stripeBadge, type Profile } from "@/components/admin/adminUserHelpers";

const MIG = join(__dirname, "..", "..", "supabase", "migrations");
function allowedStatuses(): string[] {
  const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
  let last: string | null = null;
  for (const f of files) {
    const m = /profiles_idv_status_check\s+CHECK\s*\(\s*idv_status\s+IN\s*\(([^)]*)\)/i.exec(readFileSync(join(MIG, f), "utf8"));
    if (m) last = m[1];
  }
  return (last ?? "").split(",").map((v) => v.trim().replace(/^'|'$/g, "")).filter(Boolean);
}

const label = (p: Partial<Profile>) => render(stripeBadge(p as Profile)).container.textContent ?? "";
const EXPECTED: Record<string, string> = {
  not_started: "Not Verified",
  skipped: "Not Verified",
  pending: "Stripe Checking",
  processing: "Stripe Checking",
  verified: "ID Verified",
  failed: "Stripe Flagged",
  manual_review: "Stripe Flagged",
};

describe("admin ID badge states", () => {
  const statuses = allowedStatuses();

  it("reads the allowed statuses from the migrations", () => {
    expect(statuses.length).toBeGreaterThanOrEqual(5);
    expect(statuses).toContain("pending");
  });

  it("maps every allowed status to its own badge (a new status must be added here)", () => {
    for (const s of statuses) {
      expect(EXPECTED[s], `no expected badge for new idv_status "${s}"`).toBeDefined();
      expect(label({ idv_status: s }), `idv_status=${s}`).toContain(EXPECTED[s]);
    }
    expect(label({ idv_status: null })).toContain("Not Verified");
  });

  it("never implies the user submitted an ID to us", () => {
    for (const s of [...statuses, null]) expect(label({ idv_status: s })).not.toMatch(/submitted/i);
  });
});
