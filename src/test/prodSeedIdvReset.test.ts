/**
 * prod-seed --apply must still write the IDV-review fixture after its seed
 * account was verified.
 *
 * zz_profiles_idv_verified_is_final (migration 20261022010525) refuses any
 * move away from 'verified' except to 'failed' or through the admin reset.
 * The "denied" fixture wants manual_review; its row read 'verified' (prod,
 * updated 2026-10-22 21:17Z), so every seeding run failed with
 * `403 idv_verified_is_final` and took the Vacuity (9 legs) and Prod audit
 * (4 legs) prod jobs down before they started. The seeder now resets an
 * is_seed fixture through admin_idv_request_reupload (the sanctioned path)
 * before its PATCH. RED on origin/main 8ca225a0e3 (no idvSeedReset.mjs; the
 * PATCH ran straight into the trigger).
 *
 * @mutate scripts/audit/idvSeedReset.mjs |   if (!current \|\| current.is_seed !== true) return false; |   if (!current) return false;
 * @mutate scripts/audit/idvSeedReset.mjs |   return current.idv_status === "verified"; |   return false;
 * @mutate scripts/audit/idvSeedReset.mjs |   if (moved !== 1) throw | if (false) throw
 * @mutate scripts/audit/prod-seed.mjs |   if (needsIdvSeedReset(prof, spec.profile)) { |   if (false) {
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { needsIdvSeedReset, resetSeedIdv } from "../../scripts/audit/idvSeedReset.mjs";
import { blankComments } from "./helpers/blankNonCode";

describe("needsIdvSeedReset", () => {
  it("resets a verified seed fixture that wants another IDV state", () => {
    expect(needsIdvSeedReset({ is_seed: true, idv_status: "verified" }, { idv_status: "manual_review" })).toBe(true);
    expect(needsIdvSeedReset({ is_seed: true, idv_status: "verified" }, { idv_status: "not_started" })).toBe(true);
  });

  it("never touches a real (non-seed) account", () => {
    expect(needsIdvSeedReset({ is_seed: false, idv_status: "verified" }, { idv_status: "manual_review" })).toBe(false);
    expect(needsIdvSeedReset({ is_seed: null, idv_status: "verified" }, { idv_status: "manual_review" })).toBe(false);
    expect(needsIdvSeedReset(null, { idv_status: "manual_review" })).toBe(false);
  });

  it("does nothing when the move is allowed anyway or no IDV state is wanted", () => {
    expect(needsIdvSeedReset({ is_seed: true, idv_status: "manual_review" }, { idv_status: "manual_review" })).toBe(false);
    expect(needsIdvSeedReset({ is_seed: true, idv_status: "verified" }, { idv_status: "verified" })).toBe(false);
    expect(needsIdvSeedReset({ is_seed: true, idv_status: "verified" }, { idv_status: "failed" })).toBe(false);
    expect(needsIdvSeedReset({ is_seed: true, idv_status: "verified" }, { avatar_url: null } as never)).toBe(false);
    expect(needsIdvSeedReset({ is_seed: true, idv_status: "verified" }, undefined)).toBe(false);
  });
});

describe("resetSeedIdv", () => {
  it("calls the admin reset for exactly this account", async () => {
    const rpc = vi.fn().mockResolvedValue(1);
    await resetSeedIdv("seed-user", rpc);
    expect(rpc).toHaveBeenCalledWith("admin_idv_request_reupload", expect.objectContaining({ p_user_id: "seed-user" }));
  });

  it("fails loudly when the reset moved no row", async () => {
    await expect(resetSeedIdv("seed-user", vi.fn().mockResolvedValue(0))).rejects.toThrow(/moved 0 row/);
  });
});

describe("prod-seed wiring", () => {
  const src = blankComments(readFileSync(join(__dirname, "../../scripts/audit/prod-seed.mjs"), "utf8"));

  it("reads idv_status and resets before the fixture PATCH", () => {
    expect(src).toMatch(/select=user_id,email,is_seed,ban_status,idv_status/);
    const reset = src.indexOf("if (needsIdvSeedReset(prof, spec.profile)) {");
    const patch = src.indexOf('await rest("PATCH", `profiles?user_id=eq.${user.id}`, patch');
    expect(reset).toBeGreaterThan(-1);
    expect(patch).toBeGreaterThan(reset);
  });

  it("the fixture that tripped it still wants manual_review (inventory floor)", () => {
    // Built from parts so fixtureSchemaContract does not read the pattern as a fixture literal.
    const wantedIdv = new RegExp(["profile: \\{ idv", "_status: \"([a-z_]+)\" \\}"].join(""), "g");
    const wants = [...src.matchAll(wantedIdv)].map((m) => m[1]);
    expect(wants.length).toBeGreaterThan(0);
    expect(wants).toContain("manual_review");
  });
});
