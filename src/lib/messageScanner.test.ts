import { describe, it, expect } from "vitest";
import { scanMessage, hasViolation } from "./messageScanner";

// messageScanner is the gatekeeper that prevents off-platform activity
// in chat. A miss here silently routes scammers to phone/email/Venmo
// outside Helpr's auditable rails. Tests focus on:
//   - patterns that MUST be flagged (regression guard against accidental
//     regex relaxation)
//   - common business-legitimate phrases that must NOT be flagged
//     (false positives drive support volume + erode user trust)

describe("scanMessage", () => {
  describe("phone numbers", () => {
    it("flags 10-digit US numbers in standard formats", () => {
      const cases = [
        "Call me at 504-555-1234",
        "Call me at (504) 555-1234",
        "Call me at 504.555.1234",
        "Call me at 5045551234",
        "Call me at 504 555 1234",
      ];
      for (const msg of cases) {
        const v = scanMessage(msg);
        expect(v.some((x) => x.type === "phone_number"), `should flag: ${msg}`).toBe(true);
      }
    });

    it("flags +1-prefixed numbers", () => {
      const v = scanMessage("My cell is +1 504-555-1234");
      expect(v.some((x) => x.type === "phone_number")).toBe(true);
    });

    it("does NOT flag 9-digit strings (too short)", () => {
      const v = scanMessage("Order number 12345-6789");
      expect(v.some((x) => x.type === "phone_number")).toBe(false);
    });
  });

  describe("emails", () => {
    it("flags standard email addresses", () => {
      const v = scanMessage("Reach me at user@example.com");
      expect(v.some((x) => x.type === "email")).toBe(true);
    });

    it("flags emails embedded in longer messages", () => {
      const v = scanMessage("Sounds good, my work email is jane.doe+work@company.co.uk if needed");
      const email = v.find((x) => x.type === "email");
      expect(email).toBeDefined();
      expect(email?.match).toContain("jane.doe+work@company.co.uk");
    });

    it("does NOT flag bare @-mentions or social handles", () => {
      const v = scanMessage("@user just checking in");
      expect(v.some((x) => x.type === "email")).toBe(false);
    });
  });

  describe("payment apps", () => {
    it("flags Venmo/CashApp/Zelle/PayPal mentions", () => {
      for (const word of ["Venmo", "CashApp", "Cash App", "Zelle", "PayPal"]) {
        const v = scanMessage(`Can we do ${word} instead?`);
        expect(v.some((x) => x.type === "payment_app"), word).toBe(true);
      }
    });

    it("flags Apple Pay / Google Pay (with space)", () => {
      expect(scanMessage("apple pay works for me").some((x) => x.type === "payment_app")).toBe(true);
      expect(scanMessage("Google Pay is fine").some((x) => x.type === "payment_app")).toBe(true);
    });

    it("flags crypto mentions", () => {
      for (const word of ["bitcoin", "BTC", "ETH", "crypto"]) {
        const v = scanMessage(`I'll send via ${word}`);
        expect(v.some((x) => x.type === "payment_app"), word).toBe(true);
      }
    });

    it("matches case-insensitively", () => {
      expect(scanMessage("VENMO works").some((x) => x.type === "payment_app")).toBe(true);
      expect(scanMessage("venmo works").some((x) => x.type === "payment_app")).toBe(true);
    });
  });

  describe("direct-pay phrases", () => {
    it("flags 'pay me direct' style phrases", () => {
      const cases = [
        "let's pay me direct",
        "we can do this off the app",
        "easier to handle outside the app",
        "text me about this",
        "call me later",
        "DM me on whatsapp",
        "reach me at the number above",
        "skip the fee that way",
        "just to avoid the fee",
      ];
      for (const msg of cases) {
        const v = scanMessage(msg);
        expect(v.some((x) => x.type === "direct_pay"), `should flag: ${msg}`).toBe(true);
      }
    });

    it("does NOT flag normal scheduling language", () => {
      const cases = [
        "What time should I come by?",
        "I'll be there at 3pm",
        "The address is 123 Main Street",
        "Sounds good, see you tomorrow",
      ];
      for (const msg of cases) {
        const v = scanMessage(msg);
        expect(v.length, `should not flag: ${msg}`).toBe(0);
      }
    });
  });

  it("returns multiple violations when several patterns match", () => {
    const v = scanMessage("Just venmo me at 504-555-1234 — easier than the app");
    const types = v.map((x) => x.type);
    expect(types).toContain("phone_number");
    expect(types).toContain("payment_app");
    // "off the app" / "outside the app" — this one is "than the app" which doesn't match,
    // so just assert the two we know about.
  });

  it("returns an empty array for clean messages", () => {
    expect(scanMessage("On my way, see you in 10 minutes!")).toEqual([]);
  });

  it("each violation includes the matched substring + a human-readable label", () => {
    const v = scanMessage("Email me at test@example.com");
    expect(v).toHaveLength(1);
    expect(v[0].match).toBe("test@example.com");
    expect(v[0].label).toMatch(/email/i);
  });
});

describe("hasViolation", () => {
  it("returns true for any flagged content", () => {
    expect(hasViolation("Call me at 504-555-1234")).toBe(true);
    expect(hasViolation("send via venmo")).toBe(true);
  });

  it("returns false for clean content", () => {
    expect(hasViolation("Sounds good!")).toBe(false);
    expect(hasViolation("")).toBe(false);
  });
});
