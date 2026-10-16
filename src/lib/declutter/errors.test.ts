/**
 * The plain words for every Declutter refusal (src/lib/declutter/errors.ts).
 * The two-way match against the migrations lives in
 * src/test/declutterErrorCopy.test.ts; this file pins the BEHAVIOUR of
 * declutterErrorMessage(): which source of words wins, the fallback for a code
 * nobody wrote words for, and that the copy tables hold no empty or repeated
 * sentence.
 *
 * @mutate src/lib/declutter/errors.ts |   if (typeof e.userMessage === "string" && e.userMessage) return e.userMessage; |   if (false) return e.userMessage;
 * @mutate src/lib/declutter/errors.ts |     return DECLUTTER_CLIENT_ERROR_COPY[message]; |     return GENERIC;
 * @mutate src/lib/declutter/errors.ts |   if (e.code === "23514") return "Check the details |   if (e.code === "23514x") return "Check the details
 * @mutate src/lib/declutter/errors.ts |   if (message && Object.prototype.hasOwnProperty.call(DECLUTTER_ERROR_COPY, message)) { |   if (message && message in DECLUTTER_ERROR_COPY) {
 * @mutate src/lib/declutter/errors.ts |   if (e.code === "23514" && /Keep contact details and payment off the listing/.test(message)) return message; |   if (false) return message;
 */
import { describe, expect, it } from "vitest";
import {
  DECLUTTER_CLIENT_ERROR_COPY,
  DECLUTTER_ERROR_COPY,
  ListingPhotoError,
  declutterErrorMessage,
} from "./errors";

const GENERIC = "Something went wrong. Please try again.";

describe("the copy tables", () => {
  const all = { ...DECLUTTER_ERROR_COPY, ...DECLUTTER_CLIENT_ERROR_COPY };

  it("holds a real inventory (every refusal code, both tables)", () => {
    expect(Object.keys(DECLUTTER_ERROR_COPY).length).toBeGreaterThanOrEqual(30);
    expect(Object.keys(DECLUTTER_CLIENT_ERROR_COPY).sort()).toEqual(["address_not_found", "ai_photos_required", "ai_timed_out", "ai_unavailable", "payment_unavailable"]);
  });

  it("no code sits in both tables", () => {
    const dupes = Object.keys(DECLUTTER_CLIENT_ERROR_COPY).filter((c) => c in DECLUTTER_ERROR_COPY);
    expect(dupes).toEqual([]);
  });

  it("every code is a snake_case word and every message is real words", () => {
    for (const [code, msg] of Object.entries(all)) {
      expect(code, code).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(msg.trim(), code).toBe(msg);
      expect(msg.length, code).toBeGreaterThan(10);
      // Plain words for a member, never the raw code or a developer's token.
      expect(msg, code).not.toContain(code);
      expect(msg, code).not.toMatch(/_/);
    }
  });

  it("no two codes share one sentence", () => {
    const seen = new Map<string, string>();
    const repeats: string[] = [];
    for (const [code, msg] of Object.entries(all)) {
      const first = seen.get(msg);
      if (first) repeats.push(`${first} = ${code}`);
      else seen.set(msg, code);
    }
    expect(repeats).toEqual([]);
  });

  it("no message is the generic fallback", () => {
    expect(Object.values(all)).not.toContain(GENERIC);
  });
});

describe("declutterErrorMessage maps every code to its own message", () => {
  const cases = [
    ...Object.entries(DECLUTTER_ERROR_COPY),
    ...Object.entries(DECLUTTER_CLIENT_ERROR_COPY),
  ];

  it.each(cases)("%s (as an Error)", (code, msg) => {
    expect(declutterErrorMessage(new Error(code))).toBe(msg);
  });

  it("a bare string and a Supabase error object map the same way", () => {
    expect(declutterErrorMessage("under_18")).toBe(DECLUTTER_ERROR_COPY.under_18);
    expect(declutterErrorMessage({ message: "own_item", code: "P0001" })).toBe(DECLUTTER_ERROR_COPY.own_item);
  });

  it("trims the message before looking it up", () => {
    expect(declutterErrorMessage(new Error("  photos_required \n"))).toBe(DECLUTTER_ERROR_COPY.photos_required);
  });

  it("the app/edge codes map through the client table", () => {
    expect(declutterErrorMessage(new Error("ai_unavailable"))).toBe(DECLUTTER_CLIENT_ERROR_COPY.ai_unavailable);
    expect(declutterErrorMessage("ai_photos_required")).toBe(DECLUTTER_CLIENT_ERROR_COPY.ai_photos_required);
  });
});

describe("declutterErrorMessage fallbacks and priority", () => {
  it("nothing thrown at all gives the generic words", () => {
    for (const nothing of [null, undefined, "", 0, false]) {
      expect(declutterErrorMessage(nothing)).toBe(GENERIC);
    }
  });

  it("an unknown code gives the generic words, never the raw code", () => {
    const out = declutterErrorMessage(new Error("some_future_code"));
    expect(out).toBe(GENERIC);
    expect(out).not.toContain("some_future_code");
    expect(declutterErrorMessage("some_future_code")).toBe(GENERIC);
    expect(declutterErrorMessage({})).toBe(GENERIC);
    expect(declutterErrorMessage({ message: 42 })).toBe(GENERIC);
  });

  it("object-prototype names are not codes", () => {
    for (const name of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
      expect(declutterErrorMessage(new Error(name)), name).toBe(GENERIC);
    }
  });

  it("a listing-photo refusal shows its own sentence as written", () => {
    expect(declutterErrorMessage(new ListingPhotoError("That photo could not be cleaned."))).toBe("That photo could not be cleaned.");
  });

  it("an empty listing-photo error falls through to the generic words", () => {
    expect(declutterErrorMessage(new ListingPhotoError(""))).toBe(GENERIC);
  });

  it("a userMessage set at the call site wins over the message's own code", () => {
    const e = Object.assign(new Error("under_18"), { userMessage: "Words from RPC_ERROR_COPY." });
    expect(declutterErrorMessage(e)).toBe("Words from RPC_ERROR_COPY.");
  });

  it("an empty or non-string userMessage is ignored", () => {
    expect(declutterErrorMessage(Object.assign(new Error("under_18"), { userMessage: "" }))).toBe(DECLUTTER_ERROR_COPY.under_18);
    expect(declutterErrorMessage(Object.assign(new Error("under_18"), { userMessage: 7 }))).toBe(DECLUTTER_ERROR_COPY.under_18);
  });

  it("the contact-leak check_violation sentence is passed through", () => {
    const leak = "Phone number detected in the title. Keep contact details and payment off the listing; questions, payment and pickup happen in the app.";
    expect(declutterErrorMessage({ message: leak, code: "23514" })).toBe(leak);
  });

  it("any other check_violation hides the developer text and says what to check", () => {
    const out = declutterErrorMessage({ message: 'new row violates check constraint "declutter_items_title_check"', code: "23514" });
    expect(out).toBe("Check the details: the title needs 3 to 80 characters and each field must be filled in.");
    expect(out).not.toContain("declutter_items_title_check");
  });

  it("the contact-leak sentence is only passed through for a check_violation", () => {
    const leak = "Keep contact details and payment off the listing.";
    expect(declutterErrorMessage({ message: leak, code: "P0001" })).toBe(GENERIC);
  });
});
