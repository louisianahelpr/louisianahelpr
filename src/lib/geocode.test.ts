import { describe, it, expect } from "vitest";
import { composeJobAddress } from "./geocode";

describe("composeJobAddress", () => {
  it("formats full address as 'street, city, state zip'", () => {
    expect(
      composeJobAddress({
        streetAddress: "123 Main St",
        city: "Baton Rouge",
        state: "LA",
        zipCode: "70801",
      }),
    ).toBe("123 Main St, Baton Rouge, LA 70801");
  });

  it("drops empty segments", () => {
    expect(
      composeJobAddress({
        streetAddress: "456 Oak Ave",
        city: "New Orleans",
        state: "LA",
        zipCode: "",
      }),
    ).toBe("456 Oak Ave, New Orleans, LA");
  });

  it("trims whitespace from each segment", () => {
    expect(
      composeJobAddress({
        streetAddress: "  789 Bourbon  ",
        city: "  NOLA  ",
        state: "  LA  ",
        zipCode: "  70130  ",
      }),
    ).toBe("789 Bourbon, NOLA, LA 70130");
  });

  it("handles all-null input gracefully", () => {
    expect(
      composeJobAddress({
        streetAddress: null,
        city: null,
        state: null,
        zipCode: null,
      }),
    ).toBe("");
  });

  it("handles partial input (city + state only)", () => {
    expect(
      composeJobAddress({
        city: "Lafayette",
        state: "LA",
      }),
    ).toBe("Lafayette, LA");
  });

  it("collapses state-zip group cleanly when only one is present", () => {
    expect(
      composeJobAddress({
        streetAddress: "123 Main",
        city: "Houma",
        state: "LA",
      }),
    ).toBe("123 Main, Houma, LA");
    expect(
      composeJobAddress({
        streetAddress: "123 Main",
        city: "Houma",
        zipCode: "70360",
      }),
    ).toBe("123 Main, Houma, 70360");
  });
});
