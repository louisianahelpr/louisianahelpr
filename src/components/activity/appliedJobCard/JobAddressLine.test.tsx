import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { JobAddressLine, hasStreetAddress } from "./JobAddressLine";

describe("JobAddressLine (VN-55)", () => {
  it("prints the full street address as text", () => {
    render(<JobAddressLine location="2217 Magazine St, New Orleans, LA 70130" />);
    expect(screen.getByText("2217 Magazine St, New Orleans, LA 70130")).toBeInTheDocument();
  });

  it("renders nothing for a masked, city-only location", () => {
    const { container } = render(<JobAddressLine location="New Orleans" />);
    expect(container).toBeEmptyDOMElement();
    expect(hasStreetAddress("Garden District, New Orleans")).toBe(false);
    expect(hasStreetAddress(null)).toBe(false);
  });
});
