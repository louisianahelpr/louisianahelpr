// @mutate scripts/audit/press-every-control.mjs | isAdminStateToggle({ persona, meta, label }) \|\| isAccountSettingToggle({ persona, meta, label })) { | isAdminStateToggle({ persona, meta, label })) {
// @mutate scripts/audit/pressProdSafety.mjs |   if (isAccountSettingToggle({ persona, meta, label })) return urlOwned.owned && !urlOwned.shared ? null : SKIP_ACCOUNT_SETTING; |   void SKIP_ACCOUNT_SETTING;
// @mutate scripts/audit/pressProdSafety.mjs |   if (meta.inForm) return false; |   if (meta.inForm !== undefined) return false;
// @mutate scripts/audit/press-every-control.mjs |       inForm: el.closest("form") !== null, |       inFormX: el.closest("form") !== null,
/*
 * CLASS GUARD (docs/OPEN.md Q200): the prod presser never flips an ACCOUNT
 * SETTING on a shared test account. Extends Q166's admin-settings rule
 * (pressNeverFlipsAdminSettings.test.ts) to every persona.
 *
 * Proven from the API gateway's edge_logs on 2026-09-23: the Accessibility
 * tab's "Senior Mode" switch was pressed by press-every-control shard 4 as the
 * customer and the helper — bare `PATCH /rest/v1/profiles?user_id=eq.<id>`
 * (the toggle's own write) from the runner's 127.0.0.1:4173 preview at
 * 05:55:47Z / 05:56:52Z (run 35822080143) and 09:06:10Z / 09:07:15Z (run
 * 35837735324), matching the run log's `[/profile?tab=accessibility customer]
 * pressed=10`. Shard 2's per-shard profile "restore" at 11:02Z then wrote
 * senior_mode from a snapshot taken mid-flip, and both shared accounts stayed
 * in Senior Mode: every later audit screenshot and journey rendered enlarged.
 *
 * Why the gate let it through: a non-admin switch never entered the mutating
 * branch at all, and /profile is a SELF route, where mutations are allowed
 * because the account is test-owned. The account IS test-owned; it is also
 * SHARED, which is the whole problem.
 *
 * Inventory: every role="switch" / checkbox the app renders outside the admin
 * area (settings screens), counted from source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error - plain .mjs tool script, no types
import * as safety from "../../scripts/audit/pressProdSafety.mjs";

const ROOT = resolve(__dirname, "../..");
const isAccountSettingToggle = safety.isAccountSettingToggle as (a: Record<string, unknown>) => boolean;
const mutationGate = safety.mutationGate as (a: Record<string, unknown>) => Promise<string | null>;
const SKIP_ACCOUNT_SETTING = safety.SKIP_ACCOUNT_SETTING as string;

/** The meta ENUMERATE produces for the Senior Mode switch runs 35822080143 / 35837735324 pressed. */
const SENIOR_MODE = { role: "switch", tag: "button", type: "button", inForm: false, rowText: "" };

const gate = (persona: string, routeUrl: string, label: string, meta: Record<string, unknown>, urlOwned = { owned: false, shared: false }) =>
  mutationGate({
    label,
    meta,
    chainOwned: false,
    persona,
    routeUrl,
    urlOwned,
    owners: { names: ["poster-e2e", "helper-e2e"], ids: [] },
    stripeMode: async () => ({ mode: "test", detail: "test" }),
    note: () => {},
  });

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "admin" && name !== "test") walk(p, out); }
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

describe("the prod presser never flips an account setting on a shared test account", () => {
  it("inventory: non-admin screens really do render settings toggles (floor)", () => {
    const files = walk(join(ROOT, "src"));
    expect(files.length).toBeGreaterThan(200);
    const n = files
      .map((f) => (blankComments(readFileSync(f, "utf8")).match(/role="switch"|<Switch\b/g) ?? []).length)
      .reduce((a, b) => a + b, 0);
    expect(n).toBeGreaterThan(2);
  });

  it.each([
    ["customer", "/profile?tab=accessibility", "Senior Mode", SENIOR_MODE],
    ["helper", "/profile?tab=accessibility", "Senior Mode", SENIOR_MODE],
    ["helper", "/profile?tab=availability", "Available now", { role: "switch", tag: "button", type: "button", inForm: false, rowText: "" }],
    ["customer", "/profile?tab=notifications", "Job alerts", { role: "checkbox", tag: "button", type: "button", inForm: false, rowText: "" }],
    ["customer", "/auto-tip", "Auto-tip", { role: null, tag: "input", type: "checkbox", inForm: false, rowText: "" }],
    ["helper", "/profile?tab=availability", "Pause", { role: null, tag: "button", type: "button", inForm: false, rowText: "" }],
  ])("%s pressing %s's %s is a mutating account-setting toggle, and the gate refuses it", async (persona, route, label, meta) => {
    expect(isAccountSettingToggle({ persona, meta, label })).toBe(true);
    await expect(gate(persona, route, label, meta)).resolves.toBe(SKIP_ACCOUNT_SETTING);
  });

  it("is not a blanket refusal: a draft field in a form, ordinary buttons, and the run's own fixture record stay pressable", async () => {
    const formBox = { role: "checkbox", tag: "button", type: "button", inForm: true, rowText: "" };
    expect(isAccountSettingToggle({ persona: "customer", meta: formBox, label: "Flexible date" })).toBe(false);
    expect(isAccountSettingToggle({ persona: "customer", meta: { role: "tab", tag: "button", inForm: false }, label: "Earnings" })).toBe(false);
    expect(isAccountSettingToggle({ persona: "admin", meta: SENIOR_MODE, label: "Senior Mode" })).toBe(false);
    await expect(gate("customer", "/jobs/abc", "Urgent", SENIOR_MODE, { owned: true, shared: false })).resolves.toBeNull();
  });

  it("the sweep's mutating branch consults it, and ENUMERATE records whether a control is inside a form", () => {
    const src = blankComments(readFileSync(join(ROOT, "scripts/audit/press-every-control.mjs"), "utf8"));
    const branch = src.match(/if \(DESTRUCTIVE_RX\.test\(label\)[^\n]*\{/);
    expect(branch, "the mutating-control branch moved; re-point this guard").not.toBeNull();
    expect(branch![0]).toContain("isAccountSettingToggle({ persona, meta, label })");
    expect(src).toMatch(/\binForm:\s*el\.closest\("form"\) !== null/);
  });
});
