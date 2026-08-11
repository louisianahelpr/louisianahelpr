import { describe, it, expect } from "vitest";
import { parseLocationIntoFields } from "./postJobFormHelpers";

/**
 * `parseLocationIntoFields` turns a stored `location` string back into the
 * discrete address fields for the repost / draft-restore paths.
 *
 * The callers branch on whether `city` came back DEFINED: defined means "I
 * parsed this, apply all four fields", undefined means "I couldn't, put it in
 * the street box and leave the rest alone". That contract is the thing worth
 * protecting here — a regression in it silently corrupts a job's address
 * rather than throwing, because the submit path recomposes the string from
 * whatever ends up in the fields.
 */
describe("parseLocationIntoFields", () => {
  it("splits a full street address", () => {
    expect(parseLocationIntoFields("123 Main St, Baton Rouge, LA 70801")).toEqual({
      streetAddress: "123 Main St",
      city: "Baton Rouge",
      addrState: "LA",
      zipCode: "70801",
    });
  });

  // The regression this file exists for. "Baton Rouge, LA" used to fall through
  // to the catch-all and become the STREET, while city/state/zip kept the
  // poster's stale profile values — which the submit path then recomposed and
  // wrote back as "Baton Rouge, LA, Delcambre, LA, 70501".
  it("maps a city/state pair to city + state, not to the street field", () => {
    expect(parseLocationIntoFields("Baton Rouge, LA")).toEqual({
      streetAddress: "",
      city: "Baton Rouge",
      addrState: "LA",
      zipCode: "",
    });
  });

  it("keeps a zip when the city/state pair carries one", () => {
    expect(parseLocationIntoFields("Lafayette, LA 70501")).toEqual({
      streetAddress: "",
      city: "Lafayette",
      addrState: "LA",
      zipCode: "70501",
    });
  });

  it("normalises a lowercase state abbreviation", () => {
    expect(parseLocationIntoFields("Houma, la")).toMatchObject({ addrState: "LA" });
  });

  // Two parts where the second is NOT a state abbreviation is genuinely
  // ambiguous ("123 Main St, Apt 4"), so it must keep the old catch-all
  // behaviour — and must leave `city` undefined so callers don't clobber the
  // fields the user already filled in.
  it("leaves an ambiguous two-part string as the street address", () => {
    const parsed = parseLocationIntoFields("123 Main St, Apt 4");
    expect(parsed).toEqual({ streetAddress: "123 Main St, Apt 4" });
    expect(parsed.city).toBeUndefined();
  });

  it("handles empty and nullish input without throwing", () => {
    expect(parseLocationIntoFields("")).toEqual({ streetAddress: "" });
    expect(parseLocationIntoFields(null)).toEqual({ streetAddress: "" });
    expect(parseLocationIntoFields(undefined)).toEqual({ streetAddress: "" });
  });
});
