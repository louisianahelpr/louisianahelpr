/**
 * CS-002: the privacy policy's vendor list omitted processors the app really
 * sends personal data to (Apple MapKit JS, Resend, and on re-inventory
 * OpenStreetMap Nominatim and Google Gemini). Every third-party host a
 * non-test source file calls must map to a name the policy states; a new host
 * fails here until it is either disclosed or listed as carrying no personal
 * data. Inventory: every https host in src and supabase/functions.
 *
 * Q1190 (owner, 2026-10-03): push is iOS-only (Q1126), nothing calls FCM, so
 * the three FCM hosts left DISCLOSED and the policy names APNs only; the legal
 * version was NOT bumped (owner: removing an unused processor needs none).
 *
 * @mutate src/pages/info/legal/PrivacySection.tsx | push-notification delivery (APNs). | push-notification delivery (APNs / FCM).
 * @mutate src/pages/info/legal/PrivacySection.tsx | <strong className="text-foreground">Resend</strong> | <strong className="text-foreground">Mailer</strong>
 * @mutate src/pages/info/legal/PrivacySection.tsx | <strong className="text-foreground">Anthropic (Claude)</strong> | <strong className="text-foreground">An AI model</strong>
 * @mutate src/pages/info/legal/PrivacySection.tsx | <strong className="text-foreground">Cloudflare (Turnstile)</strong> | <strong className="text-foreground">A bot check</strong>
 * @mutate src/pages/info/legal/PrivacySection.tsx | <strong className="text-foreground">Twilio</strong> | <strong className="text-foreground">Our texting provider</strong>
 *
 * Q2336 (owner, 2026-10-20): Twilio (SMS alerts) is named in the vendor list.
 * The name must appear IN the "Service providers we rely on" list, not merely
 * somewhere on the page: the "Text messages" paragraph also says "Twilio", and
 * a whole-page match let the list omit it.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readdirSync } from "./helpers/trackedFiles";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx|mjs)$/.test(n) && !/\.test\.tsx?$|\/test\//.test(p) ? [p] : [];
  });
}

// host → the name the policy must contain.
const DISCLOSED: Record<string, string> = {
  "api.stripe.com": "Stripe",
  "checkout.stripe.com": "Stripe",
  "verify.stripe.com": "Stripe",
  "us.i.posthog.com": "PostHog",
  "sentry.io": "Sentry",
  "cdn.apple-mapkit.com": "MapKit",
  "nominatim.openstreetmap.org": "OpenStreetMap",
  // Owner 2026-10-22: AI drafting is Claude only (Gemini removed).
  "api.anthropic.com": "Anthropic",
  "api.resend.com": "Resend",
  // Q1314 (owner, 2026-10-05): Turnstile disclosed, NO legal version bump.
  "challenges.cloudflare.com": "Cloudflare (Turnstile)",
  "messaging.twilio.com": "Twilio",
  // Q2336 (owner, 2026-10-20): SMS alerts send through Twilio.
  "api.twilio.com": "Twilio",
};
// Hosts that are links, our own domains, test fixtures, or calls that carry no
// personal data (HIBP gets a 5-char hash prefix only).
// @two-way src/test/privacyPolicyNamesEveryProcessor.test.ts:expect(undisclosed).toEqual([]);
const NOT_PROCESSORS = [
  "louisianahelpr.com", "example.com", "evil.com", "dashboard.stripe.com", "amazon.com",
  "apple.com", "facebook.com", "google.com", "gravatar.com", "httpbin.org", "dicebear.com",
  "ui-avatars.com", "pwnedpasswords.com", "schema.org", "vercel.com", "vercel.app", "supabase.com",
  "supabase.co", "instagram.com", "slack.com", "googleusercontent.com", "airbnb.com", "booking.com",
  "deno.land", "esm.sh", "x.dev", "vrbo.com", "github.com", "w3.org", "googleapis.com/auth",
  "hooks.slack.com", "ipify.org", "irs.gov", "haveibeenpwned.com", "invalid",
  "vercel-insights.com", "jsdelivr.net", "unpkg.com", "npmjs.com",
  // Never called: csp-report/report.ts names the Vercel Toolbar's script URL
  // only to drop the browser's report that our CSP BLOCKED it (no data sent).
  "vercel.live",
  // A link only: the Homes lease shows the EPA lead pamphlet (40 CFR 745.107) to a tenant of a pre-1978 home.
  "epa.gov",
  // A docs link in a comment (supabase/functions/_shared/smsPolicy.ts, Twilio's
  // request-signing docs); the host that receives data is DISCLOSED above.
  "www.twilio.com",
];

const files = [...walk("src"), ...walk("supabase/functions")];
const hosts = new Set<string>();
for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/g)) hosts.add(m[1]);
const policy = readFileSync("src/pages/info/legal/PrivacySection.tsx", "utf8");
// The vendor list itself: the <ul> under "Service providers we rely on".
const vendorList = policy.slice(policy.indexOf('title="Service providers we rely on"')).match(/<ul[\s\S]*?<\/ul>/)?.[0] ?? "";

describe("the privacy policy names every data processor (CS-002)", () => {
  it("the inventory is real", () => {
    expect(hosts.size).toBeGreaterThan(30);
  });
  it("every called host is disclosed or known not to be a processor", () => {
    const undisclosed = [...hosts].filter((h) => !DISCLOSED[h] && !NOT_PROCESSORS.some((n) => h === n || h.endsWith(`.${n}`) || h.endsWith(n)));
    expect(undisclosed).toEqual([]);
  });
  it("the policy no longer names FCM: push is iOS-only and nothing calls it (Q1190)", () => {
    expect(policy).not.toMatch(/\bFCM\b/);
    expect([...hosts].filter((h) => h === "fcm.googleapis.com")).toEqual([]);
  });
  it("each processor's name appears in the policy's vendor list", () => {
    expect(vendorList.match(/<li>/g)?.length ?? 0).toBeGreaterThan(8);
    const missing = [...new Set(Object.values(DISCLOSED))].filter((n) => !vendorList.includes(n));
    expect(missing).toEqual([]);
  });
});
