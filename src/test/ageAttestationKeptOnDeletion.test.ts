/**
 * Q1826 — OWNER DECISION 2026-10-14 (~7:30 PM CT, pop-up): KEEP the 18+ record
 * on deletion. purge_user_data and wipe_pre_verification_account clear
 * date_of_birth but leave profiles.age_attested_at ON PURPOSE: it is a bare
 * timestamp of when the member ticked "I confirm I am 18 years of age or
 * older", not personal data on an anonymised row, and it is the record of that
 * attestation. This guard reads the definition each function has after every
 * migration (effectiveDefs) and fails if either one starts clearing it.
 *
 * @mutate supabase/migrations/20261006204113_job_materials_and_access_notes.sql |            date_of_birth            = NULL, |            date_of_birth            = NULL, age_attested_at = NULL,
 * @mutate supabase/migrations/20261015020859_promotions_before_unsubscribe.sql |          date_of_birth           = NULL, |          date_of_birth           = NULL, age_attested_at = NULL,
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = resolve(__dirname, "../../supabase/migrations");
const KEEPERS = ["purge_user_data", "wipe_pre_verification_account"];

describe("account deletion keeps the 18+ attestation record (Q1826, owner 2026-10-14)", () => {
  const defs = effectiveDefs(DIR);

  it.each(KEEPERS)("%s clears the birthday but keeps age_attested_at", (name) => {
    const def = defs.get(name);
    expect(def, `${name} has no live definition in the migrations`).toBeTruthy();
    const code = blankSqlComments(def!.stmt);
    // Inventory floor: the function is the deletion path we think it is.
    expect(code).toMatch(/date_of_birth\s*=\s*NULL/i);
    expect(code, `${name} now clears age_attested_at; the owner chose to keep it (Q1826)`).not.toMatch(/age_attested_at/i);
  });

  it("reads both deletion paths", () => {
    expect(KEEPERS.filter((k) => defs.has(k)).length).toBe(2);
  });
});
