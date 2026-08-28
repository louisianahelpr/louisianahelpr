// Regression cover for the 2026-08-27 identity leak: the applicant-vetting
// screen showed Eli Thibodeaux's name, avatar, bio and trust record for the
// helper who had actually applied, because `get_safe_profiles` matches two key
// spaces and the caller took row [0]. These cases pin the real prod uuids.

import { describe, it, expect } from "vitest";
import { pickRequestedProfile } from "./safeProfiles";

// Audit Helper's auth id — which is ALSO Eli Thibodeaux's profiles.id.
const AUDIT_HELPER_AUTH_ID = "6bdc1f67-ae1f-46a0-8edf-4035629a6147";
const ELI_AUTH_ID = "11111111-1111-1111-1111-111111111104";

describe("pickRequestedProfile", () => {
  it("never returns a row that matches neither key — the P0", () => {
    // Exactly what prod returned: asked for the helper, got Eli, because Eli's
    // profiles.id happens to equal the helper's auth id.
    const rows = [{ user_id: ELI_AUTH_ID, profile_id: AUDIT_HELPER_AUTH_ID }];
    expect(pickRequestedProfile(rows, AUDIT_HELPER_AUTH_ID)).toBeNull();
  });

  it("prefers the true user_id owner over a colliding profile_id row", () => {
    // Both come back for one input. The person whose auth id it is must win,
    // regardless of which row the database happened to emit first.
    const collision = { user_id: ELI_AUTH_ID, profile_id: AUDIT_HELPER_AUTH_ID };
    const realOwner = { user_id: AUDIT_HELPER_AUTH_ID, profile_id: "aaaaaaaa-0000-4000-8000-000000000001" };
    expect(pickRequestedProfile([collision, realOwner], AUDIT_HELPER_AUTH_ID)).toBe(realOwner);
    expect(pickRequestedProfile([realOwner, collision], AUDIT_HELPER_AUTH_ID)).toBe(realOwner);
  });

  it("does NOT fall back to profile_id when the true owner is filtered out", () => {
    // The trap. `get_safe_profiles` withholds banned/unapproved rows, so the
    // owner's row being absent is NORMAL — Audit Helper is temp_banned. A
    // "no user_id row, so try profile_id" rule would hand back Eli here and
    // rebuild the original bug. Absent must stay absent.
    const onlyTheCollision = [{ user_id: ELI_AUTH_ID, profile_id: AUDIT_HELPER_AUTH_ID }];
    expect(pickRequestedProfile(onlyTheCollision, AUDIT_HELPER_AUTH_ID)).toBeNull();
  });

  it("returns the row for an ordinary unambiguous hit", () => {
    const row = { user_id: ELI_AUTH_ID, profile_id: "cccccccc-0000-4000-8000-000000000004" };
    expect(pickRequestedProfile([row], ELI_AUTH_ID)).toBe(row);
  });

  it("handles empty, null and missing-id inputs without throwing", () => {
    expect(pickRequestedProfile([], AUDIT_HELPER_AUTH_ID)).toBeNull();
    expect(pickRequestedProfile(null, AUDIT_HELPER_AUTH_ID)).toBeNull();
    expect(pickRequestedProfile(undefined, AUDIT_HELPER_AUTH_ID)).toBeNull();
    // A null requested id must never match a row whose keys are also null.
    expect(pickRequestedProfile([{ user_id: null, profile_id: null }], null)).toBeNull();
    expect(pickRequestedProfile([{ user_id: null, profile_id: null }], undefined)).toBeNull();
  });
});
