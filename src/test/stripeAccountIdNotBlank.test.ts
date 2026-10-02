import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { blankSqlComments } from "./helpers/blankNonCode";

/**
 * Q871 — a blank profiles.stripe_account_id can never onboard.
 *
 * stripe-connect getOrCreateAccount treats '' as "no account yet", but its
 * Q868 compare-and-set links the new account with .is("stripe_account_id",
 * null), which matches no row holding '', so every attempt 500s. The column
 * is NULL or a real acct_ id, enforced by profiles_stripe_account_id_not_blank.
 *
 * This guard reads every migration: the constraint must be added with the
 * btrim CHECK, and no later migration may drop it.
 *
 * Behaviour (red before, 3x replay): src/test/pglite/blankStripeAccountIdForbidden.pglite.mjs.
 *
 * @mutate supabase/migrations/20261002055253_forbid_blank_stripe_account_id.sql | CHECK (stripe_account_id IS NULL OR btrim(stripe_account_id) <> ''); | CHECK (true);
 * @mutate supabase/migrations/20261002055253_forbid_blank_stripe_account_id.sql |     ALTER TABLE public.profiles\n      ADD CONSTRAINT profiles_stripe_account_id_not_blank | \n    PERFORM 1; -- profiles_stripe_account_id_not_blank
 */

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const NAME = "profiles_stripe_account_id_not_blank";

const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const sql = (f: string) => blankSqlComments(readFileSync(resolve(MIGRATIONS, f), "utf8"));

describe("Q871 — profiles.stripe_account_id is NULL or a real id, never blank", () => {
  it("a migration adds the not-blank CHECK on profiles", () => {
    const adders = files.filter((f) =>
      new RegExp(
        String.raw`ALTER\s+TABLE\s+public\.profiles\s+ADD\s+CONSTRAINT\s+${NAME}\s+CHECK\s*\(\s*stripe_account_id\s+IS\s+NULL\s+OR\s+btrim\(\s*stripe_account_id\s*\)\s*<>\s*''\s*\)`,
        "i",
      ).test(sql(f)),
    );
    expect(files.length, "inventory floor: migrations were read").toBeGreaterThan(0);
    expect(adders).toEqual(["20261002055253_forbid_blank_stripe_account_id.sql"]);
  });

  it("no migration after it drops the constraint", () => {
    const addedAt = files.indexOf("20261002055253_forbid_blank_stripe_account_id.sql");
    expect(addedAt, "inventory floor: the adding migration exists").toBeGreaterThanOrEqual(0);
    const droppers = files
      .slice(addedAt + 1)
      .filter((f) => new RegExp(String.raw`DROP\s+CONSTRAINT\s+(IF\s+EXISTS\s+)?${NAME}\b`, "i").test(sql(f)));
    expect(droppers).toEqual([]);
  });
});
