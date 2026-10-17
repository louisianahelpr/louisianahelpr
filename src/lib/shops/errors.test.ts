/**
 * shopsErrorMessage, the one place a Shops screen turns an error into words
 * (lh-silent-failure re-review of 603408318e).
 *
 *  1. A ListingPhotoError (cleanListingPhoto, used by shop photos in slice 1's
 *     api.ts and item photos in items.ts) shows its own plain words, as
 *     declutterErrorMessage does; it used to fall through to "Something went
 *     wrong".
 *  2. The contact-leak refusal shows the server's sentence, read from the
 *     NEWEST definitions of both triggers, which no longer point at a Message
 *     button shops do not have (the Shops Message button item in docs/OPEN.md).
 *  3. item_changed (lh-authz-rls re-review N1) has its words.
 *
 * @mutate src/lib/shops/errors.ts |   if (err instanceof ListingPhotoError && err.message) return err.message;\n | \n
 * @mutate src/lib/shops/errors.ts |   if (e.code === "23514" && /does not allow contact details in Shops\.$/.test(message)) return message; |   if (e.code === "23514" && /members reach you with the Message button/.test(message)) return message;
 * @mutate supabase/migrations/20261017061157_shops_items.sql | off your items; Louisiana Helpr does not allow contact details in Shops.'; | off your items; members reach you with the Message button.';
 * @mutate supabase/migrations/20261017061157_shops_items.sql | off your shop; Louisiana Helpr does not allow contact details in Shops.'; | off your shop; members reach you with the Message button.';
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { ListingPhotoError } from "@/lib/declutter/errors";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";
import { blankSqlComments } from "@/test/helpers/blankNonCode";
import { SHOPS_ERROR_COPY, shopsErrorMessage } from "./errors";

const GENERIC = "Something went wrong. Please try again.";
const DEFS = effectiveDefs(join(process.cwd(), "supabase/migrations"));

/** The sentence a contact-leak trigger raises, built from its newest body. */
function leakSentence(fn: string, reason: string, where: string): string {
  const body = blankSqlComments(DEFS.get(fn)?.stmt ?? "");
  const m = /MESSAGE = v_reason \|\| ' in the ' \|\| v_where \|\| '((?:[^']|'')*)';/.exec(body);
  expect(m, `${fn} raises a MESSAGE`).not.toBeNull();
  return `${reason} in the ${where}${m![1].replace(/''/g, "'")}`;
}

describe("shopsErrorMessage", () => {
  it("shows a ListingPhotoError's own words", () => {
    expect(shopsErrorMessage(new ListingPhotoError("That photo could not be cleaned. Try another one."))).toBe(
      "That photo could not be cleaned. Try another one.",
    );
    expect(shopsErrorMessage(new ListingPhotoError(""))).toBe(GENERIC);
  });

  it("shows both contact-leak refusals as the server wrote them, with no Message button", () => {
    for (const [fn, where] of [["reject_contact_leak_in_shop_item", "description"], ["reject_contact_leak_in_shop", "about"]] as const) {
      const sentence = leakSentence(fn, "Phone number detected", where);
      expect(sentence).not.toMatch(/Message button/);
      expect(shopsErrorMessage({ code: "23514", message: sentence })).toBe(sentence);
    }
    expect(shopsErrorMessage({ code: "23514", message: "new row violates check constraint" })).toBe(
      "Check the details: each field must be filled in.",
    );
  });

  it("names item_changed", () => {
    expect(shopsErrorMessage(new Error("item_changed"))).toBe(SHOPS_ERROR_COPY.item_changed);
    expect(SHOPS_ERROR_COPY.item_changed).toMatch(/changed this item/);
  });
});
