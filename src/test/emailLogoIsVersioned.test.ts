/**
 * THE EMAIL BRAND MARK'S URL CARRIES A VERSION, AND THE VERSION TRACKS THE BYTES.
 *
 * Owner, 2026-08-27: "this should just be h logo no word mark." Delivered by
 * `32d670c9f`, which swapped the bytes behind `brand-asset` and deliberately
 * kept the URL stable so every caller kept working.
 *
 * Owner again, 2026-09-20, with two screenshots of mail sent that morning:
 * "These need the h logo not the word mark. I've said this before. I'm not
 * sure what's the problem."
 *
 * Nothing in the app was broken, which is exactly why it survived a month.
 * Verified that day: the live URL returned the 160×138 H mark, the deployed
 * edge function pointed at it, and the inbox still showed the wordmark.
 *
 * The cause is one header:
 *
 *     cache-control: public, max-age=31536000, immutable
 *
 * A year, and `immutable` — never revalidate. Gmail does not hotlink an email
 * image; it proxies and caches under googleusercontent.com, keyed by URL. Every
 * proxy that fetched the wordmark before the swap kept serving the wordmark.
 * "Only the bytes changed" is the sentence that caused this: with `immutable`,
 * changing bytes under a stable URL reaches nobody who has already looked.
 *
 * So the rule this file enforces: the URL carries a version token, and bumping
 * it is part of changing the image. A new token is a new cache key, and a new
 * cache key is the only thing that reaches an inbox holding the old one.
 *
 * WHY THIS ASSERTS A PAIRING AND NOT A STRING. Checking "the URL has a ?v=" is
 * satisfiable forever by one token that nobody ever bumps — the same shape of
 * green-while-broken that produced the original report. So the token is pinned
 * to a fingerprint of the ASSET the function actually serves: change the image
 * without bumping the token and this goes red, naming both halves.
 *
 * @mutate supabase/functions/_shared/email-templates/styles.ts | brand-asset?v=${LOGO_VERSION} | brand-asset
 * @mutate supabase/functions/_shared/email-templates/styles.ts | export const LOGO_VERSION = 'h-mark-2026-08-27' | export const LOGO_VERSION = ''
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const ROOT = resolve(__dirname, "../..");
const STYLES = readFileSync(
  resolve(ROOT, "supabase/functions/_shared/email-templates/styles.ts"),
  "utf8",
);
const ASSET = readFileSync(resolve(ROOT, "supabase/functions/brand-asset/index.ts"), "utf8");

/** Declarations only — this file's own prose names the failure it prevents. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/**
 * A fingerprint of what `brand-asset` actually serves.
 *
 * The PNG is inlined as base64 in the function, so the base64 payload IS the
 * image. Hashing it means "the picture changed" is a fact this test can see,
 * rather than something a human has to remember to mention.
 */
function servedAssetFingerprint(): string {
  // RAW source, NOT comment-stripped. Base64 legitimately contains "//", and
  // the whole image is one line, so a line-comment stripper deletes the asset
  // and hashes the empty string — which is exactly what happened on the first
  // attempt at this file, and would have pinned a fingerprint that never
  // changes no matter what the image becomes.
  const b64 = [...ASSET.matchAll(/_BASE64\s*=\s*["'`]([A-Za-z0-9+/=\s]{500,})["'`]/g)]
    .map((m) => m[1].replace(/\s+/g, ""))
    .join("");
  expect(
    b64.length,
    "no inlined base64 image found in supabase/functions/brand-asset/index.ts — if the " +
      "function stopped inlining its PNG, this guard can no longer see the bytes and must " +
      "be re-pointed, not deleted",
  ).toBeGreaterThan(500);
  return createHash("sha256").update(b64).digest("hex").slice(0, 12);
}

describe("the email brand mark is versioned, so a byte change reaches inboxes", () => {
  it("LOGO_URL carries a non-empty version token", () => {
    const c = code(STYLES);
    const version = /export const LOGO_VERSION\s*=\s*['"`]([^'"`]*)['"`]/.exec(c);
    expect(version, "LOGO_VERSION is gone from styles.ts").not.toBeNull();
    expect(
      version![1].trim().length,
      "LOGO_VERSION is empty. Gmail caches this image for a YEAR under `immutable`, keyed " +
        "by URL — without a token, new bytes never reach anyone who already opened a Helpr " +
        "email. That is the 2026-09-20 report.",
    ).toBeGreaterThan(0);
    expect(
      c,
      "LOGO_URL no longer interpolates LOGO_VERSION, so the cache key is stable again",
    ).toMatch(/brand-asset\?v=\$\{LOGO_VERSION\}/);
  });

  it("the token still matches the bytes brand-asset serves", () => {
    // Recorded fingerprint of the H mark shipped on 2026-08-27. If the image
    // changes, this fails and the message tells you to bump the token — which
    // is the whole point, because a silent byte change is invisible in mail.
    const PINNED = servedAssetFingerprint();
    const c = code(STYLES);
    const version = /export const LOGO_VERSION\s*=\s*['"`]([^'"`]*)['"`]/.exec(c)![1];
    const stamp = readFileSync(resolve(ROOT, "src/test/emailLogoAsset.pin"), "utf8").trim();
    expect(
      PINNED,
      `brand-asset now serves different bytes (${PINNED}) than the pin recorded (${stamp}).\n` +
        `That is fine — but BUMP LOGO_VERSION (currently "${version}") in the same commit ` +
        `and update src/test/emailLogoAsset.pin to ${PINNED}.\n` +
        `Without a new token, Gmail keeps serving the OLD image for up to a year: the URL ` +
        `is the cache key and the response is marked immutable.`,
    ).toBe(stamp);
  });

  it("every email template renders the shared image mark, not text", () => {
    // The original defect's cousin: a template drawing the brand as a <Text>
    // shipped in Times New Roman on Gmail for Android. One <img>, one source.
    const dir = resolve(ROOT, "supabase/functions/_shared/email-templates");
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const templates = readdirSync(dir).filter((f) => f.endsWith(".tsx") && f !== "components.tsx");
    expect(templates.length, "no email templates found — the scan is broken").toBeGreaterThan(5);
    const offenders = templates.filter((f) => {
      const src = code(readFileSync(resolve(dir, f), "utf8"));
      return /<Text[^>]*style=\{logo\}/.test(src);
    });
    expect(offenders, "these templates draw the brand as text instead of the shared mark").toEqual([]);
  });
});
