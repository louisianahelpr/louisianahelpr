/**
 * press-every-control 41817058240 (11-04 scheduled; Q946, lead 11-04) left four kinds of GATE MISS after the tour
 * heal and referral mint (pressLookSideEffectsAreNotMisses.test.ts):
 *  - save_my_job_post_draft x16: Post a job keeps the member's own draft as the form changes (a category tile is a
 *    change): a side effect, still aborted and noted;
 *  - rpc_ensure_my_handle x6: Settings' "Your profile link" makes the member's own handle on first look: a side effect;
 *  - saved_searches PATCH x3: opening a saved search stamps last_seen_at: a side effect by its BODY (turning alerts on
 *    or off is still a write);
 *  - "Refresh membership status" x3 (error toast): it asks Stripe for the billing state, so it is a payment control,
 *    gated on the Stripe mode, not pressed ungated into an aborted call;
 *  - export-my-data x6: "Download my data" now runs the export at once (a3980e666f), so the control is MUTATING and
 *    goes through the gate.
 *
 * @mutate scripts/audit/pressProdSafety.mjs |   "/rest/v1/rpc/save_my_job_post_draft": | "/rest/v1/rpc/save_my_job_post_draft_x":
 * @mutate scripts/audit/pressProdSafety.mjs |   "/rest/v1/rpc/rpc_ensure_my_handle": | "/rest/v1/rpc/rpc_ensure_my_handle_x":
 * @mutate scripts/audit/pressProdSafety.mjs |     keys: ["last_seen_at"], |     keys: ["last_seen_at", "notify_enabled"],
 * @mutate scripts/audit/pressProdSafety.mjs | export const DATA_EXPORT_RX = /\bdownload my data\b/i; | export const DATA_EXPORT_RX = /\bdownload my files\b/i;
 * @mutate scripts/audit/pressProdSafety.mjs | reset & start fresh\|refresh membership\| | reset & start fresh\|
 * @mutate scripts/audit/press-every-control.mjs | \|\| isAccountSettingToggle({ persona, meta, label }) \|\| isDataExport({ label })) { | \|\| isAccountSettingToggle({ persona, meta, label })) {
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error - plain .mjs tool script, no types
import * as safety from "../../scripts/audit/pressProdSafety.mjs";

const ROOT = resolve(__dirname, "..", "..");
const BASE = "https://fncmgoasalhdgfwzhsqa.supabase.co";
const kind = (method: string, path: string, body: string | null = null): string =>
  safety.pressWriteKind({ method, url: `${BASE}${path}`, body });

describe("press gate: the misses left in run 41817058240", () => {
  it("the member's own Post a job draft and profile-link handle are side effects", () => {
    expect(kind("POST", "/rest/v1/rpc/save_my_job_post_draft", JSON.stringify({ p_draft: { category: "yard" } }))).toBe("side-effect");
    expect(kind("POST", "/rest/v1/rpc/rpc_ensure_my_handle", "{}")).toBe("side-effect");
    // Their neighbours are still writes.
    expect(kind("POST", "/rest/v1/rpc/rpc_set_my_handle", JSON.stringify({ p_handle: "x" }))).toBe("write");
  });

  it("opening a saved search is a side effect; changing its alerts is a write", () => {
    expect(kind("PATCH", "/rest/v1/saved_searches?id=eq.s1&user_id=eq.u1&select=id", JSON.stringify({ last_seen_at: "2026-11-04T16:00:00Z" }))).toBe("side-effect");
    expect(kind("PATCH", "/rest/v1/saved_searches?id=eq.s1", JSON.stringify({ notify_enabled: false }))).toBe("write");
    expect(kind("PATCH", "/rest/v1/saved_searches?id=eq.s1", JSON.stringify({ last_seen_at: "t", notify_email: false }))).toBe("write");
    expect(kind("DELETE", "/rest/v1/saved_searches?id=eq.s1", null)).toBe("write");
  });

  it("Download my data is a mutating control, and the sweep gates it", () => {
    expect(safety.isDataExport({ label: "Download my data A copy of what Helpr holds about you" })).toBe(true);
    expect(safety.isDataExport({ label: "Your profile link One link to what you post and do" })).toBe(false);
    const press = blankComments(readFileSync(resolve(ROOT, "scripts/audit/press-every-control.mjs"), "utf8"));
    const gateLine = press.split("\n").find((l) => l.includes("const why = await gate(label, meta, item.chainOwned)") || l.includes("isAccountSettingToggle({ persona, meta, label })"));
    expect(gateLine).toMatch(/isDataExport\(\{ label \}\)/);
  });

  it("Refresh membership status is a Stripe control, gated on the mode", () => {
    expect(safety.PAYMENT_RX.test("Refresh membership status")).toBe(true);
    expect(readFileSync(resolve(ROOT, "src/components/profile/SubscriptionTab.tsx"), "utf8")).toMatch(/aria-label="Refresh membership status"/);
    expect(readFileSync(resolve(ROOT, "src/components/profile/SubscriptionTab.tsx"), "utf8")).toMatch(/functions\.invoke\("check-pro-subscription"\)/);
  });

  it("each names what the app really sends", () => {
    expect(readFileSync(resolve(ROOT, "src/lib/jobPostDraftAccount.ts"), "utf8")).toMatch(/save_my_job_post_draft/);
    expect(readFileSync(resolve(ROOT, "src/lib/profileLink/api.ts"), "utf8")).toMatch(/supabase\.rpc\("rpc_ensure_my_handle"\)/);
    expect(readFileSync(resolve(ROOT, "src/lib/savedSearches.ts"), "utf8")).toMatch(/\.update\(\{ last_seen_at: new Date\(\)\.toISOString\(\) \}\)/);
    // Inventory floor: the sweep's side-effect list keeps every earlier entry (counted 2026-11-04: 10+).
    expect(Object.keys(safety.PRESS_SIDE_EFFECT_WRITES).length).toBeGreaterThan(5);
  });
});
