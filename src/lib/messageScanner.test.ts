/**
 * Characterization tests for src/lib/messageScanner.ts (F-TRUST-01).
 *
 * This scanner is ADVISORY UX only — it provides instant client-side warnings.
 * The authoritative gate is the Postgres trigger function scan_message_content()
 * (supabase/migrations/20260510033701_scan_message_remove_ambiguous.sql).
 * Both must be kept in sync; these tests pin the client's current behaviour so
 * future drift is caught immediately.
 *
 * Known intentional client-vs-server divergence (as of 2026-09-04):
 *
 *   CLIENT-ONLY (soft UX warning, no server fraud_flag):
 *     "my number" / "my email" — dropped from server (too ambiguous; 2 flags in
 *     24 h trigger a 7-day account auto-suspend, so false-positive risk outweighs
 *     the security value at the server level). Intentional and unchanged.
 *
 *   "cash only" / "in cash" used to be server-only — the server struck the
 *   sender for either phrase with no client-side warning at all, so the
 *   message read as delivered in the sender's own thread while the
 *   recipient's copy was silently hidden. Closed 2026-09-04: the client now
 *   warns on both phrases too. The server remains the sole enforcer (this
 *   scanner has never done anything but warn); the fix is purely that the
 *   sender now gets the same heads-up before send that the server will act
 *   on after send.
 *
 *   PHONE regex difference:
 *     Client:  /(\+?1?\s*[-.]?\s*\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4})/
 *       Supports leading +1, parenthesised area code, and common dash/dot/space
 *       separators between groups.
 *     Server:  [0-9]{3}[^0-9]?[0-9]{3}[^0-9]?[0-9]{4}
 *       Simpler: 3 digits, optional single non-digit, 3 digits, optional single
 *       non-digit, 4 digits. Matches a plain 10-digit run ("9855551234") but
 *       only allows ONE separator character between groups (not multiple spaces).
 *
 *   PAYMENT APP word-boundary handling:
 *     Client:  \b word boundaries prevent "ethics" matching "eth" or "depth"
 *              matching "eth".
 *     Server:  bare substring ~* match — "ethics" or "method" could false-positive
 *              on "eth" / "etho" unless the server gains word-boundary guards.
 */

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

// ---------------------------------------------------------------------------
// F-TRUST-01 drift characterization: client-only / server-only / boundary cases
// These tests document the CURRENT client behaviour.  Any change that makes
// them fail should be deliberately reviewed against scan_message_content().
// ---------------------------------------------------------------------------

describe("F-TRUST-01 — client-only phrases (no server fraud_flag)", () => {
  it("flags 'my number' [CLIENT ONLY — intentionally absent from server to avoid false-positive auto-suspends]", () => {
    const v = scanMessage("Here is my number for updates");
    expect(v.some((x) => x.type === "direct_pay")).toBe(true);
  });

  it("flags 'my email' [CLIENT ONLY — intentionally absent from server]", () => {
    const v = scanMessage("Send it to my email and I'll confirm");
    expect(v.some((x) => x.type === "direct_pay")).toBe(true);
  });
});

describe("F-TRUST-01 — 'cash only'/'in cash' now warn client-side too (closed 2026-09-04)", () => {
  // These were server-only: the server strikes the sender for either phrase,
  // but the client showed no warning before send, so the message read as
  // delivered in the sender's own thread while the recipient's copy was
  // silently hidden — a phantom-delivery bug. The client now warns on the
  // same phrases the server acts on; the server remains the sole enforcer
  // (this scanner is advisory-only, per the file header).
  it("flags 'cash only' — client now warns before the server strikes", () => {
    const v = scanMessage("I only take cash only payments");
    expect(v.some((x) => x.type === "direct_pay")).toBe(true);
  });

  it("flags 'in cash' — client now warns before the server strikes", () => {
    const v = scanMessage("Please pay me in cash");
    expect(v.some((x) => x.type === "direct_pay")).toBe(true);
  });
});

describe("F-TRUST-01 — btc/eth word-boundary false-positive guards (client uses \\b, server uses substring)", () => {
  it("does NOT flag 'ethics' (contains 'eth')", () => {
    expect(scanMessage("That raises ethics concerns").some((x) => x.type === "payment_app")).toBe(false);
  });

  it("does NOT flag 'method' (contains 'eth')", () => {
    expect(scanMessage("What payment method is preferred?").some((x) => x.type === "payment_app")).toBe(false);
  });

  it("does NOT flag 'depth' (contains 'eth')", () => {
    expect(scanMessage("I'll clean to a good depth")).not.toSatisfy((v: ReturnType<typeof scanMessage>) =>
      v.some((x) => x.type === "payment_app")
    );
  });

  it("DOES flag bare 'ETH' as a payment app token", () => {
    expect(scanMessage("Send to my ETH wallet 0xABC").some((x) => x.type === "payment_app")).toBe(true);
  });

  it("DOES flag bare 'BTC' as a payment app token", () => {
    expect(scanMessage("My BTC address is 1BoatSLRHtKNngkdXEeobR76b53LETtpyT").some((x) => x.type === "payment_app")).toBe(true);
  });
});

describe("F-TRUST-01 — phone regex: client matches formats server may miss", () => {
  it("detects phone with multiple spaces between groups (client-friendly formatting)", () => {
    // Client regex allows multiple spaces via [\s.-]*; server only allows one non-digit
    expect(scanMessage("My number is 985  555  1234").some((x) => x.type === "phone_number")).toBe(true);
  });

  it("detects phone with +1 country code prefix", () => {
    expect(scanMessage("Reach me at +1 985 555 1234").some((x) => x.type === "phone_number")).toBe(true);
  });

  it("does NOT flag a 9-digit string (order number pattern)", () => {
    expect(scanMessage("Order #12345-6789").some((x) => x.type === "phone_number")).toBe(false);
  });

  it("does NOT flag a dollar amount", () => {
    expect(scanMessage("The job pays $75 for 2 hours").some((x) => x.type === "phone_number")).toBe(false);
  });
});

describe("F-TRUST-02 — evasion heuristics (fullwidth digits + spelled-out numbers)", () => {
  it("flags fullwidth-digit phone numbers (normalized to ASCII before regex)", () => {
    // "５０４-５５５-１２３４" — fullwidth digits that the plain \d regex would miss.
    const v = scanMessage("call me at ５０４-５５５-１２３４");
    expect(v.some((x) => x.type === "phone_number")).toBe(true);
  });

  it("flags a spelled-out phone number (7+ consecutive number-words)", () => {
    const v = scanMessage("my cell is five zero four five five five one two");
    expect(v.some((x) => x.type === "phone_number")).toBe(true);
  });

  it("flags spelled-out numbers with 'oh' for zero", () => {
    const v = scanMessage("ring me five oh four five five five one two three four");
    expect(v.some((x) => x.type === "phone_number")).toBe(true);
  });

  it("does NOT flag casual short number-word usage", () => {
    const v = scanMessage("I have two cats and three dogs at home");
    expect(v.some((x) => x.type === "phone_number")).toBe(false);
  });
});

describe("F-TRUST-01 — clean legitimate job messages produce zero violations", () => {
  const cleanMessages = [
    "Hi, interested in the lawn mowing job. Are you available Saturday?",
    "I can complete the task for $50 and be done in about 2 hours.",
    "Great work today! I'll leave a 5-star review.",
    "The job is at 123 Main Street, Baton Rouge LA 70801.",
    "Please confirm receipt so I can release the payment through the app.",
    "All done! Thanks for using Louisiana Helpr.",
    "Do you accept payment through the platform only?",
    "I'm available Thursday at 10am or Friday afternoon.",
  ];

  for (const msg of cleanMessages) {
    it(`clean: "${msg.slice(0, 60)}..."`, () => {
      expect(scanMessage(msg)).toHaveLength(0);
    });
  }
});
