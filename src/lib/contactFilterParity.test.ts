import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hasViolation, scanMessage } from "./messageScanner";
import { PHONE_PATTERN, LOCATION_SHARE_PATTERN } from "./contactLeakRules";

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
 * `serverLeakReason` below is a JS replica of the function body as shipped in
 * 20260913020635_reject_contact_leaks_in_jobs_and_bios.sql (the live body read
 * via pg_get_functiondef on 2026-09-12, email domain widened), EXCEPT the phone
 * branch: that one is no longer retyped here. It is read out of the NEWEST
 * migration that defines contact_leak_reason (see `serverPhonePattern`), so a
 * migration that changes the server phone rule is exercised by this file the
 * moment it lands, instead of this replica quietly describing the old rule.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");

/**
 * The newest migration's definition of public.contact_leak_reason: any case,
 * `CREATE FUNCTION` or `CREATE OR REPLACE FUNCTION`, with or without `public.`,
 * body up to its closing dollar-quote tag (`$$` or `$function$`).
 */
function newestContactLeakReason(): { file: string; body: string } {
  const head = /^\s*create\s+(or\s+replace\s+)?function\s+(public\.)?"?contact_leak_reason"?\s*\(/im;
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, files[i]), "utf8");
    const start = sql.search(head);
    if (start === -1) continue;
    const tag = sql.slice(start).match(/\bAS\s+(\$[a-z_]*\$)/i);
    if (!tag) throw new Error(`${files[i]}: contact_leak_reason has no dollar-quoted body this test can read`);
    const open = sql.indexOf(tag[1], start);
    const close = sql.indexOf(tag[1], open + tag[1].length);
    return { file: files[i], body: sql.slice(start, close === -1 ? undefined : close) };
  }
  throw new Error("no migration defines public.contact_leak_reason — this guard is blind");
}

const NEWEST = newestContactLeakReason();

/** The SQL literal in `IF v_norm ~* '<pattern>' THEN RETURN 'Phone number detected'`. */
const serverPhonePattern = (() => {
  const m = NEWEST.body.match(/v_norm ~\* '([^']+)' THEN\s+RETURN 'Phone number detected'/i);
  if (!m) throw new Error(`${NEWEST.file}: contact_leak_reason no longer has a v_norm phone branch this test can read`);
  return m[1];
})();

/**
 * The SQL literal in `IF v_norm ~ '<pattern>' THEN RETURN NULL;` — the
 * location-share exemption (docs/OPEN.md queue #1 residual, 2026-09-15).
 * Plain `~` (case-sensitive, no `*`), which is what distinguishes this line
 * from the phone branch above and from the leading null/empty-string guard
 * (which has no regex before its `RETURN NULL;`).
 */
const serverLocationSharePattern = (() => {
  const m = NEWEST.body.match(/v_norm ~ '([^']+)' THEN\s+RETURN NULL;/);
  if (!m) throw new Error(`${NEWEST.file}: contact_leak_reason no longer has a v_norm location-share exemption this test can read`);
  return m[1];
})();

const FW = /[０-９]/g;
const normalize = (s: string) => s.replace(FW, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/**
 * THE STRIKE BRANCHES, READ OUT OF THE MIGRATION — not retyped here.
 *
 * This WAS a hand-typed JS replica of the four non-phone branches (email,
 * worded digits, payment services, payment intent). A replica is both the
 * input and the oracle: delete the email branch from a new
 * `contact_leak_reason` and every assertion in this file still passed, because
 * the replica kept answering "email". That is a trust-and-safety gap, not a
 * test nicety — the email branch IS the disintermediation gate for
 * "jane@gmail.com". So the branches are now parsed out of the same newest
 * migration `serverPhonePattern` and `serverLocationSharePattern` come from,
 * and a branch that leaves the SQL leaves this test's oracle with it.
 *
 * `\m` / `\M` (Postgres-only word boundaries) become `\b`; nothing else in
 * these literals differs between an ARE and a JS RegExp.
 */
type ServerBranch = { subject: "v_norm" | "p_text"; pattern: string; label: string };
const SERVER_BRANCHES: ServerBranch[] = [
  ...NEWEST.body.matchAll(
    /(?:IF|ELSIF)\s+(v_norm|p_text)\s+~\*\s+'([^']+)'\s+THEN\s+RETURN\s+'([^']+)'/gi,
  ),
].map((m) => ({ subject: m[1] as ServerBranch["subject"], pattern: m[2], label: m[3] }));

/** SQL's user-facing reason → the short code this file's assertions speak. */
const REASON_CODE: Record<string, string> = {
  "Phone number detected": "phone",
  "Email address detected": "email",
  "Off-platform payment service mentioned": "payment",
  "Off-platform payment intent detected": "direct",
};

const areToJs = (p: string) => p.replace(/\\[mM]/g, "\\b");

function serverLeakReason(p: string): string | null {
  if (!p || p.trim() === "") return null;
  const v = normalize(p);
  // Checked first, exactly like the live function: a message that IS this
  // exact shape can never also read as a phone number, email, or
  // off-platform-payment phrase.
  if (new RegExp(serverLocationSharePattern).test(v)) return null;
  for (const b of SERVER_BRANCHES) {
    if (new RegExp(areToJs(b.pattern), "i").test(b.subject === "v_norm" ? v : p)) {
      return REASON_CODE[b.label] ?? b.label;
    }
  }
  return null;
}

describe("the server's strike branches are read from the migration, not retyped", () => {
  it("every reason contact_leak_reason can return is still defined there", () => {
    // The floor: an empty or shortened branch list would make serverLeakReason
    // return null for everything, and the SERVER_STRIKES corpus below asserts
    // `.not.toBeNull()` first, so it fails loudly rather than vacuously.
    expect(
      SERVER_BRANCHES.length,
      `${NEWEST.file}: no IF/ELSIF ~* branch found — this guard's server oracle is blind`,
    ).toBeGreaterThanOrEqual(5);
    const codes = new Set(SERVER_BRANCHES.map((b) => REASON_CODE[b.label] ?? b.label));
    for (const want of ["phone", "email", "payment", "direct"]) {
      expect(
        codes.has(want),
        `${NEWEST.file} no longer strikes "${want}" — a contact-leak class left the server gate`,
      ).toBe(true);
    }
  });

  it("uses only regex syntax Postgres AREs and JavaScript agree on", () => {
    for (const b of SERVER_BRANCHES) {
      // `\m`/`\M` are translated; a lookbehind or a `\d`/`\w` would mean this
      // file's oracle and the real function disagree about what they match.
      for (const banned of ["(?<", "\\d", "\\w"]) {
        expect(areToJs(b.pattern).includes(banned), `${b.label}: contains ${banned}`).toBe(false);
      }
    }
  });
});

// Every string the server WILL strike. The client must warn on all of them.
const SERVER_STRIKES = [
  "call 504-555-0100",
  "504.555.0100",
  "504_555_0100",
  "+1 (504) 555-0100",
  "５０４５５５０１００",
  "one two three four five six seven",
  "email me at jane.doe@gmail.com",
  "reach me jane@my-domain.com",
  "mail me at me@mail.example.co.uk",
  "try first.last@sub-domain.example.org",
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

describe("contact-filter parity: hyphenated / multi-label domains (fixed 2026-09-13)", () => {
  // The server email regex domain WAS [a-z0-9]+\.[a-z]{2,} — no hyphen, no
  // subdomain — so `jane@my-domain.com` evaded the server gate entirely.
  // 20260913020635 widened it to match the client; both layers now catch it
  // (proven in Postgres by scripts/probes/contact-leak-reject.probe.mjs).
  for (const smuggle of ["reach me jane@my-domain.com", "me@mail.example.co.uk", "x@a-b-c.dev"]) {
    it(`both layers catch "${smuggle}"`, () => {
      expect(hasViolation(smuggle), "client scanner catches it").toBe(true);
      expect(serverLeakReason(smuggle), "SERVER MISS regressed: hyphenated/multi-label domain not detected").toBe("email");
    });
  }

  // "user (at) gmail (dot) com" style obfuscation defeats BOTH — noted so the
  // reader knows the boundary of what either layer promises.
  it("worded at/dot obfuscation evades both layers (documented limitation)", () => {
    const smuggle = "reach me jane (at) gmail (dot) com";
    expect(serverLeakReason(smuggle)).toBeNull();
    expect(hasViolation(smuggle)).toBe(false);
  });
});

/**
 * PHONE MATCHER PARITY (docs/OPEN.md queue #1, 2026-09-14).
 *
 * The bug: a prod-proof message "SEED offered-proof 20260914215014" was read as
 * a phone number by contact_leak_reason, because its phone rule was an
 * unanchored "3 digits, 3 digits, 4 digits" window that matches INSIDE any run
 * of 10+ digits. The sender got a real off-platform warning and a fraud flag.
 * The client rule had the same flaw. Both rules now require that the number is
 * not part of a longer digit run, and both are the SAME string.
 *
 * One fixture list (contactLeakPhoneFixtures.json) is run through the client
 * scanner, through the pattern literal in the newest migration (compiled as a
 * JS RegExp: sound because the pattern is restricted to the syntax subset that
 * Postgres AREs and JavaScript read identically, checked below), and through
 * the real Postgres function by scripts/probes/contact-scan-phone.probe.mjs.
 */
type PhoneFixtures = { phone: string[]; notPhone: string[] };
const PHONE_FIXTURES = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/lib/contactLeakPhoneFixtures.json"), "utf8"),
) as PhoneFixtures;

const clientFlagsPhone = (t: string) => scanMessage(t).some((v) => v.type === "phone_number");
const serverFlagsPhone = (t: string) => new RegExp(serverPhonePattern, "i").test(normalize(t));

describe("phone matcher: one definition", () => {
  it("the newest migration's server phone rule is exactly the shared PHONE_PATTERN", () => {
    expect(
      serverPhonePattern,
      `${NEWEST.file} carries a phone rule that is not src/lib/contactLeakRules.ts PHONE_PATTERN — ` +
        "client and server have drifted; change both together",
    ).toBe(PHONE_PATTERN);
  });

  it("the client scanner builds its phone regex from PHONE_PATTERN, not its own literal", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/messageScanner.ts"), "utf8");
    expect(src).toMatch(/const PHONE_REGEX = new RegExp\(PHONE_PATTERN, "gi"\)/);
  });

  it("PHONE_PATTERN uses only syntax Postgres AREs and JavaScript (incl. iOS 15 WebKit) read the same way", () => {
    // Lookbehind is a SyntaxError before Safari 16.4 (the app supports iOS 15);
    // \d \w \s \b mean different things (or nothing) in the two engines, and
    // \m \M are Postgres-only. A back-reference is not allowed in ARE lookahead.
    for (const banned of ["(?<", "\\d", "\\w", "\\s", "\\b", "\\m", "\\M", "\\1"]) {
      expect(PHONE_PATTERN.includes(banned), `PHONE_PATTERN contains ${banned}`).toBe(false);
    }
    expect(PHONE_PATTERN.includes("'"), "a quote would end the SQL literal").toBe(false);
  });
});

const clientFlagsAnything = (t: string) => hasViolation(t);
const serverFlagsAnything = (t: string) => serverLeakReason(t) !== null;
const shareOf = (lat: number, lng: number) => `📍 Location: ${lat.toFixed(6)},${lng.toFixed(6)}`;

describe("location share pattern: one definition", () => {
  it("the newest migration's location-share exemption is exactly the shared LOCATION_SHARE_PATTERN", () => {
    expect(
      serverLocationSharePattern,
      `${NEWEST.file} carries a location-share exemption that is not src/lib/contactLeakRules.ts ` +
        "LOCATION_SHARE_PATTERN — client and server have drifted; change both together",
    ).toBe(LOCATION_SHARE_PATTERN);
  });

  it("the client scanner builds its exemption from LOCATION_SHARE_PATTERN, not its own literal", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/messageScanner.ts"), "utf8");
    expect(src).toMatch(/const LOCATION_SHARE_REGEX = new RegExp\(LOCATION_SHARE_PATTERN\)/);
  });
});

describe("location shares never read as a phone number on the server (docs/OPEN.md queue #1 residual, 2026-09-15)", () => {
  // RichMessageInput sends bare "📍 Location: <lat>,<lng>" (never a URL —
  // MessageBubble builds the maps.google.com link at render time) with the
  // client scan skipped by `isLocationShare`; contact_leak_reason still
  // scans every inserted message regardless, which is what this guards.
  const SRC = readFileSync(resolve(process.cwd(), "src/components/RichMessageInput.tsx"), "utf8");

  it("every location share in RichMessageInput is the bare lat,lng shape, rounded to 6 decimals", () => {
    const shares = [...SRC.matchAll(/📍 Location: (\$\{[^`]+?\})`/g)].map((m) => m[1]);
    expect(shares.length, "no location share found in RichMessageInput.tsx — this guard is blind").toBeGreaterThanOrEqual(2);
    for (const s of shares) expect(s).toBe("${latitude.toFixed(6)},${longitude.toFixed(6)}");
    // Never the old URL-wrapped shape — that is exactly what let a 3-digit
    // longitude's digit tail line up with the phone rule.
    expect(SRC).not.toMatch(/📍 Location: https:\/\//);
  });

  // The exact repro this residual names: a real California coordinate (3-digit
  // longitude integer part) used to read as a phone number on the server even
  // though the client never scans it.
  it("a California share (-118.2437, 3-digit longitude) is never flagged, client or server", () => {
    const share = shareOf(34.052235, -118.2437);
    expect(serverFlagsAnything(share), `server still flags ${JSON.stringify(share)}`).toBe(false);
    expect(clientFlagsAnything(share), `client still flags ${JSON.stringify(share)}`).toBe(false);
  });

  it("a Louisiana share is never flagged either — no regression from the exemption", () => {
    const share = shareOf(29.9511, -90.0715); // New Orleans
    expect(serverFlagsAnything(share)).toBe(false);
    expect(clientFlagsAnything(share)).toBe(false);
  });

  it("a grid of Louisiana coordinates at 6 decimals is never flagged by the server rule", () => {
    let flagged = 0;
    let n = 0;
    // Louisiana bounding box, 0.0137 x 0.0173 steps with digit-varied tails.
    for (let lat = 28.9; lat <= 33.02; lat += 0.0137131) {
      for (let lng = -94.05; lng <= -88.8; lng += 0.0173717) {
        n++;
        if (serverFlagsAnything(shareOf(lat, lng))) flagged++;
      }
    }
    expect(n).toBeGreaterThan(50000);
    expect(flagged, `${flagged} of ${n} Louisiana location shares read as a phone number`).toBe(0);
  });

  it("a grid covering the rest of the continental US (3-digit longitudes included) is never flagged", () => {
    let flagged = 0;
    let n = 0;
    // Roughly the continental US: lat 25-49, lng -125 to -67 — crosses the
    // -100 line where a longitude's integer part goes from 2 digits to 3.
    for (let lat = 25; lat <= 49; lat += 0.7331) {
      for (let lng = -125; lng <= -67; lng += 0.9127) {
        n++;
        if (serverFlagsAnything(shareOf(lat, lng))) flagged++;
        if (clientFlagsAnything(shareOf(lat, lng))) flagged++;
      }
    }
    expect(n).toBeGreaterThan(1500);
    expect(flagged, `${flagged} of ${n * 2} continental-US location shares read as a phone number`).toBe(0);
  });
});

describe("phone matcher: client and server agree on every shared fixture", () => {
  it("the fixture list is not empty on either side", () => {
    expect(PHONE_FIXTURES.phone.length).toBeGreaterThanOrEqual(10);
    expect(PHONE_FIXTURES.notPhone.length).toBeGreaterThanOrEqual(10);
  });

  for (const t of PHONE_FIXTURES.phone) {
    it(`both flag a real phone: ${JSON.stringify(t)}`, () => {
      expect(clientFlagsPhone(t), `client scanMessage missed a phone: ${JSON.stringify(t)}`).toBe(true);
      expect(serverFlagsPhone(t), `${NEWEST.file}: server phone rule missed ${JSON.stringify(t)}`).toBe(true);
    });
  }

  for (const t of PHONE_FIXTURES.notPhone) {
    it(`neither flags a non-phone digit string: ${JSON.stringify(t)}`, () => {
      expect(clientFlagsPhone(t), `client scanMessage reads ${JSON.stringify(t)} as a phone number`).toBe(false);
      expect(serverFlagsPhone(t), `${NEWEST.file}: server reads ${JSON.stringify(t)} as a phone number`).toBe(false);
    });
  }
});

// Neuter the location-share exemption and it swallows EVERY message: the
// client scanner returns [] for anything and the server oracle returns null,
// so the whole SERVER_STRIKES corpus goes red. This is the shape of the only
// way to turn the contact filter off from one constant.
// @mutate src/lib/contactLeakRules.ts | "^📍 Location: -?[0-9]{1,3}\\.[0-9]{6},-?[0-9]{1,3}\\.[0-9]{6}$" | "^"
// Take the email branch out of the SHIPPED SQL. Before the branches were read
// from the migration (2026-09-21) this survived: the retyped replica kept
// answering "email" while the live gate let jane@gmail.com through.
// @mutate supabase/migrations/20260915030812_contact_leak_reason_exempts_location_shares.sql | ELSIF p_text ~* '[a-z0-9._]+@ | ELSIF p_text ~* 'zzz-removed@
