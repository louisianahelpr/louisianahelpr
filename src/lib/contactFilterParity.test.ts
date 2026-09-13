import { describe, it, expect } from "vitest";
import { hasViolation } from "./messageScanner";

/**
 * CONTACT-FILTER PARITY (terminal 7, 2026-09-12).
 *
 * The client scanMessage() is advisory; public.contact_leak_reason(text) in
 * Postgres is the authoritative gate (called by scan_message_content and
 * scan_application_contact_info). The class of bug this guards is DRIFT between
 * the two: if a string composes clean under the client but the server strikes
 * it, the sender is punished with no warning and the recipient's copy is
 * silently hidden ("phantom delivery" — see messageScanner.ts header). So on the
 * shared classes the client must be AT LEAST as strict as the server.
 *
 * `serverLeakReason` below is a faithful JS replica of the live function body
 * read via pg_get_functiondef on 2026-09-12. If the DB function changes, this
 * replica and messageScanner.ts must be updated together; that is the drift this
 * test exists to catch before it reaches prod.
 */

const FW = /[０-９]/g;
const normalize = (s: string) => s.replace(FW, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

function serverLeakReason(p: string): string | null {
  if (!p || p.trim() === "") return null;
  const v = normalize(p);
  if (/[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{4}/i.test(v)) return "phone";
  if (/(zero|one|two|three|four|five|six|seven|eight|nine|oh)([^a-z0-9]+(zero|one|two|three|four|five|six|seven|eight|nine|oh)){6,}/i.test(p)) return "phone";
  if (/[a-z0-9._]+@[a-z0-9]+\.[a-z]{2,}/i.test(p)) return "email";
  if (/\bvenmo\b|\bcashapp\b|\bcash app\b|\bzelle\b|\bpaypal\b|\bapple\s*pay\b|\bgoogle\s*pay\b|\bcrypto\b|\bbitcoin\b|\bbtc\b|\beth\b/i.test(p)) return "payment";
  if (/\bpay me direct\b|\boff the app\b|\boutside the app\b|\bskip the fee\b|\bavoid the fee\b|\bcash only\b|\bin cash\b|\btext me\b|\bcall me\b|\bwhatsapp\b|\btelegram\b|\bdm me\b|\bhit me up\b|\bcontact me at\b|\breach me at\b|\bsend money to\b|\bpay outside\b/i.test(p)) return "direct";
  return null;
}

// Every string the server WILL strike. The client must warn on all of them.
const SERVER_STRIKES = [
  "call 504-555-0100",
  "504.555.0100",
  "504_555_0100",
  "+1 (504) 555-0100",
  "５０４５５５０１００",
  "one two three four five six seven",
  "email me at jane.doe@gmail.com",
  "venmo works",
  "just cashapp me",
  "zelle is fine",
  "cash only please",
  "text me when you can",
  "skip the fee and pay outside",
];

describe("contact-filter parity: client is at least as strict as the server", () => {
  for (const text of SERVER_STRIKES) {
    it(`client warns on what the server strikes: "${text}"`, () => {
      expect(serverLeakReason(text), "test corpus assumes the server strikes this").not.toBeNull();
      expect(hasViolation(text), `PHANTOM DELIVERY: server strikes "${text}" but the client composes it clean`).toBe(true);
    });
  }
});

describe("contact-filter parity: known SERVER MISSES (SECURITY findings, docs/OPEN.md)", () => {
  // The server email regex domain is [a-z0-9]+\.[a-z]{2,} — no hyphen — so a
  // hyphenated domain evades the server gate entirely. A direct-API sender (who
  // never sees the client warning) can smuggle it into a message unflagged.
  it("hyphenated-domain email evades the SERVER gate (client catches it)", () => {
    const smuggle = "reach me jane@my-domain.com";
    expect(hasViolation(smuggle), "client scanner catches the hyphenated-domain email").toBe(true);
    // Documents the live gap: when the server is fixed to catch this, flip to not.toBeNull().
    expect(serverLeakReason(smuggle), "SERVER MISS: hyphenated-domain email is not detected server-side").toBeNull();
  });

  // "user (at) gmail (dot) com" style obfuscation defeats BOTH — noted so the
  // reader knows the boundary of what either layer promises.
  it("worded at/dot obfuscation evades both layers (documented limitation)", () => {
    const smuggle = "reach me jane (at) gmail (dot) com";
    expect(serverLeakReason(smuggle)).toBeNull();
    expect(hasViolation(smuggle)).toBe(false);
  });
});
