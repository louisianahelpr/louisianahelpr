/**
 * A-005: vercel.json's CSP connect-src allowed https://api.openai.com, a host
 * the browser never calls (ai-job-builder is an edge function, and it now calls
 * Gemini). Every connect-src entry widens where an injected script can send
 * data, so each one must be justified: either client code (src/ non-test,
 * index.html) names the host, or it is an SDK-implied host listed below with
 * its reason. Inventory: the live connect-src list itself.
 *
 * @mutate vercel.json | https://snofje0za8n8.cloud.run; frame-src | https://snofje0za8n8.cloud.run https://api.openai.com; frame-src
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readdirSync } from "./helpers/trackedFiles";

// Hosts no source file names literally, because an SDK or env var supplies them.
const SDK_IMPLIED: Record<string, string> = {
  "supabase.co": "Supabase client; project URL comes from VITE_SUPABASE_URL",
  "api.stripe.com": "Stripe.js",
  "stripe.com": "Stripe.js subdomains (m.stripe.com, r.stripe.com)",
  "posthog.com": "posthog-js ingest and assets",
  "sentry.io": "@sentry/react ingest; DSN comes from env",
  "vercel-insights.com": "@vercel/analytics and @vercel/speed-insights",
  "facebook.com": "Meta Pixel: fbevents.js (src/lib/metaPixel.ts, the website only) sends its events to www.facebook.com/tr",
  // Exact hosts, never a suffix: the owner's pixel config (connect.facebook.net/signals/config/2088408795197912, read
  // 2026-11-22) turns on Meta's Conversions API Gateway ("openbridge"), and fbevents.js fetch()es these two. A new
  // gateway host is blocked (csp-report drops that report as noise) until it is added here and in vercel.json.
  "7r-3c0d146726ae4cb698a4c85f7b2ff5f9.ecs.us-west-2.on.aws": "Meta Conversions API Gateway (fbevents.js openbridge), the owner's pixel config",
  "snofje0za8n8.cloud.run": "Meta Conversions API Gateway fallback (fbevents.js openbridge), the owner's pixel config",
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "test" ? [] : walk(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}
const clientText = [...walk("src"), "index.html"].map((f) => readFileSync(f, "utf8")).join("\n");

const csp = JSON.stringify(JSON.parse(readFileSync("vercel.json", "utf8")));
const connectSrc = (csp.match(/connect-src ([^;"]*)/)?.[1] ?? "")
  .split(/\s+/)
  .filter((s) => /^(https|wss):\/\//.test(s))
  .map((s) => s.replace(/^\w+:\/\/(\*\.)?/, ""));

const justified = (h: string) =>
  clientText.includes(h) || Object.keys(SDK_IMPLIED).some((k) => h === k || h.endsWith(`.${k}`));

describe("every CSP connect-src host is used by the browser (A-005)", () => {
  it("the inventory is real", () => {
    expect(connectSrc.length).toBeGreaterThan(8);
  });
  it("no connect-src host is unjustified", () => {
    expect(connectSrc.filter((h) => !justified(h))).toEqual([]);
  });
});
