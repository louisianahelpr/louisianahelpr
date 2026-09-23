// @mutate scripts/audit/press-every-control.mjs | PAYMENT_RX.test(label) \|\| isAdminStateToggle({ persona, meta, label })) { | PAYMENT_RX.test(label)) {
// @mutate scripts/audit/pressProdSafety.mjs | if (persona !== "admin") return false; | return false;
// @mutate scripts/audit/press-every-control.mjs |       role: el.getAttribute("role"), |       roleX: el.getAttribute("role"),
/*
 * CLASS GUARD (docs/OPEN.md Q42): the prod presser never flips an ADMIN SETTING.
 *
 * Proven from the API gateway's edge_logs on 2026-09-23: every
 * press-every-control run from 22 Sep 17:52Z onward PATCHed
 * `marketing_settings` as admin@louisianahelpr.com (referer
 * http://127.0.0.1:4173/, the workflow's vite preview). The 10:50:07Z PATCH
 * from run 35837735324 is what turned `auto_publish_enabled` ON on prod — the
 * switch that lets scheduled rows post to the business's public Instagram.
 * Nobody chose it; the sweep pressed it, then pressed the confirm ("Turn on").
 *
 * Why the old gate let it through: a control counted as mutating only if its
 * LABEL matched DESTRUCTIVE_RX / PAYMENT_RX or it was type=submit. A switch's
 * label is the setting's name ("Auto-publish", "Instagram", "Facebook"), and
 * the confirm says "Turn on". So the class is "a state toggle pressed as
 * admin", decided by ROLE, not by vocabulary.
 *
 * The inventory is the app itself: every role="switch" rendered on an admin
 * screen is a Radix <Switch>, so the floor counts <Switch in src/components/admin.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error - plain .mjs tool script, no types
import * as safety from "../../scripts/audit/pressProdSafety.mjs";

const ROOT = resolve(__dirname, "../..");
const isAdminStateToggle = safety.isAdminStateToggle as (a: Record<string, unknown>) => boolean;
const mutationGate = safety.mutationGate as (a: Record<string, unknown>) => Promise<string | null>;
const SKIP_ADMIN = safety.SKIP_ADMIN as string;

/** The exact meta ENUMERATE produces for the controls run 35837735324 pressed. */
const AUTO_PUBLISH = { role: "switch", tag: "button", type: "button", rowText: "Auto-publish is OFF Nothing publishes automatically." };
const INSTAGRAM = { role: "switch", tag: "button", type: "button", rowText: "Instagram Off — nothing publishes to this channel." };

const adminGate = (label: string, meta: Record<string, unknown>) =>
  mutationGate({
    label,
    meta,
    chainOwned: false,
    persona: "admin",
    routeUrl: "/admin?view=social",
    urlOwned: { owned: false, shared: false },
    owners: { names: ["admin-e2e", "poster-e2e", "helper-e2e"], ids: [] },
    stripeMode: async () => ({ mode: "test", detail: "test" }),
    note: () => {},
  });

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

describe("the prod presser never flips an admin setting", () => {
  it("inventory: admin screens really do render switches (floor)", () => {
    const files = walk(join(ROOT, "src/components/admin"));
    expect(files.length).toBeGreaterThan(50);
    const n = files
      .map((f) => (blankComments(readFileSync(f, "utf8")).match(/<Switch\b/g) ?? []).length)
      .reduce((a, b) => a + b, 0);
    expect(n).toBeGreaterThan(2);
  });

  it.each([
    ["Auto-publish", AUTO_PUBLISH],
    ["Instagram", INSTAGRAM],
    ["Turn on", { role: null, tag: "button", type: "button", rowText: "Turn on auto-publish?" }],
    ["Enable", { role: null, tag: "button", type: "button", rowText: "" }],
    ["Email alerts", { role: "checkbox", tag: "button", type: "button", rowText: "" }],
    ["Weekly digest", { role: null, tag: "input", type: "checkbox", rowText: "" }],
  ])("%s pressed as admin is a mutating state toggle, and the gate refuses it", async (label, meta) => {
    expect(isAdminStateToggle({ persona: "admin", meta, label })).toBe(true);
    await expect(adminGate(label, meta)).resolves.toBe(SKIP_ADMIN);
  });

  it("is not a blanket refusal: a non-admin's own settings switch and ordinary admin navigation stay pressable", () => {
    expect(isAdminStateToggle({ persona: "customer", meta: AUTO_PUBLISH, label: "Auto-publish" })).toBe(false);
    expect(isAdminStateToggle({ persona: "admin", meta: { role: "tab", tag: "button" }, label: "Queue" })).toBe(false);
    expect(isAdminStateToggle({ persona: "admin", meta: { role: null, tag: "a" }, label: "View job" })).toBe(false);
  });

  it("the sweep's mutating branch consults it, and ENUMERATE records the role it reads", () => {
    const src = blankComments(readFileSync(join(ROOT, "scripts/audit/press-every-control.mjs"), "utf8"));
    const branch = src.match(/if \(DESTRUCTIVE_RX\.test\(label\)[^\n]*\{/);
    expect(branch, "the mutating-control branch moved; re-point this guard").not.toBeNull();
    expect(branch![0]).toContain("isAdminStateToggle({ persona, meta, label })");
    expect(src).toMatch(/\brole:\s*el\.getAttribute\("role"\)/);
  });
});
