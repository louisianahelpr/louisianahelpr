/**
 * The duplicate-phone refusal (trg_guard_profile_phone) is said in words on
 * every screen that saves a phone, never as a generic "couldn't save".
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PHONE_IN_USE_MESSAGE, phoneInUseMessage } from "./mutationResult";

describe("phoneInUseMessage", () => {
  it("recognises the database's refusal, directly or as a cause", () => {
    const pg = { code: "23505", hint: "phone_in_use", message: PHONE_IN_USE_MESSAGE };
    expect(phoneInUseMessage(pg)).toBe(PHONE_IN_USE_MESSAGE);
    expect(phoneInUseMessage({ message: "wrapped", cause: pg })).toBe(PHONE_IN_USE_MESSAGE);
  });
  it("leaves every other error alone", () => {
    expect(phoneInUseMessage({ code: "23505", message: "duplicate key value violates unique constraint applications_pkey" })).toBeNull();
    expect(phoneInUseMessage(new Error("network"))).toBeNull();
    expect(phoneInUseMessage(null)).toBeNull();
  });
  it("every screen that saves a phone uses it (inventory)", () => {
    for (const f of ["src/pages/profile/Profile.tsx", "src/pages/auth/CompleteProfile.tsx", "src/components/PhotoPrompt.tsx"]) {
      expect(readFileSync(f, "utf8"), f).toMatch(/phoneInUseMessage\(/);
    }
  });
});
// @mutate src/lib/mutationResult.ts |   if (e.code === "23505" && (e.hint === "phone_in_use" | if (false && (e.hint === "phone_in_use"
