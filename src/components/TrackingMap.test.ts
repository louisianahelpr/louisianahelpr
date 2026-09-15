import { describe, it, expect } from "vitest";
import { destinationIcon, helperIcon } from "./TrackingMap";

/**
 * VN-20: the settled arrival fact is drawn ON the job pin. The label is
 * interpolated into Leaflet divIcon HTML, so it is also a closed set.
 */
describe("TrackingMap destinationIcon", () => {
  it("draws no label when there is no settled arrival", () => {
    const icon = destinationIcon(null);
    expect(String(icon.options.html)).not.toContain("data-arrival-label");
  });

  it("draws the arrival label on the pin and names it for screen readers", () => {
    const icon = destinationIcon("Location confirmed");
    expect(String(icon.options.html)).toContain("data-arrival-label");
    expect(String(icon.options.html)).toContain("Location confirmed");
    const el = icon.createIcon();
    expect(el.getAttribute("aria-label")).toBe("The job location · Location confirmed");
  });

  it("refuses any string outside the fixed label set", () => {
    const icon = destinationIcon("<img src=x onerror=alert(1)>");
    expect(String(icon.options.html)).not.toContain("onerror");
    expect(icon.createIcon().getAttribute("aria-label")).toBe("The job location");
  });
});

describe("TrackingMap helperIcon", () => {
  it("names a live position only while en route; after arrival it is the last ping", () => {
    expect(helperIcon(true).createIcon().getAttribute("aria-label")).toBe("Your Helpr's current location");
    expect(helperIcon(false).createIcon().getAttribute("aria-label")).toBe("Your Helpr's last shared location");
  });
});
