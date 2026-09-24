/**
 * CS-002: the privacy policy's vendor list omitted processors the app really
 * sends personal data to (Apple MapKit JS, Resend, and on re-inventory
 * OpenStreetMap Nominatim and Google Gemini). Every third-party host a
 * non-test source file calls must map to a name the policy states; a new host
 * fails here until it is either disclosed or listed as carrying no personal
 * data. Inventory: every https host in src and supabase/functions.
 *
 * @mutate src/pages/info/legal/PrivacySection.tsx | <strong className="text-foreground">Resend</strong> | <strong className="text-foreground">Mailer</strong>
 * @mutate src/pages/info/legal/PrivacySection.tsx | <strong className="text-foreground">Google Gemini</strong> | <strong className="text-foreground">An AI model</strong>
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
  "generativelanguage.googleapis.com": "Gemini",
  "api.resend.com": "Resend",
  "fcm.googleapis.com": "FCM",
  "oauth2.googleapis.com": "FCM",
  "www.googleapis.com": "FCM",
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
  // Our own ops alerts to our own Slack, relayed by Lovable's connector gateway.
  "connector-gateway.lovable.dev", "vercel-insights.com", "jsdelivr.net", "unpkg.com", "npmjs.com",
];

const files = [...walk("src"), ...walk("supabase/functions")];
const hosts = new Set<string>();
for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/g)) hosts.add(m[1]);
const policy = readFileSync("src/pages/info/legal/PrivacySection.tsx", "utf8");

describe("the privacy policy names every data processor (CS-002)", () => {
  it("the inventory is real", () => {
    expect(hosts.size).toBeGreaterThan(30);
  });
  it("every called host is disclosed or known not to be a processor", () => {
    const undisclosed = [...hosts].filter((h) => !DISCLOSED[h] && !NOT_PROCESSORS.some((n) => h === n || h.endsWith(`.${n}`) || h.endsWith(n)));
    expect(undisclosed).toEqual([]);
  });
  it("each processor's name appears in the policy", () => {
    const missing = [...new Set(Object.values(DISCLOSED))].filter((n) => !policy.includes(n));
    expect(missing).toEqual([]);
  });
});
