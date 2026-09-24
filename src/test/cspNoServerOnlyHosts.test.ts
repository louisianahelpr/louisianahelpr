/**
 * A-005: vercel.json's CSP connect-src allowed https://api.openai.com, a host
 * the browser never calls (ai-job-builder is an edge function, and it now calls
 * Gemini). Every connect-src entry widens where an injected script can send
 * data, so each one must be justified: either client code (src/ non-test,
 * index.html) names the host, or it is an SDK-implied host listed below with
 * its reason. Inventory: the live connect-src list itself.
 *
 * @mutate vercel.json | https://vitals.vercel-insights.com; | https://vitals.vercel-insights.com https://api.openai.com;
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Hosts no source file names literally, because an SDK or env var supplies them.
const SDK_IMPLIED: Record<string, string> = {
  "supabase.co": "Supabase client; project URL comes from VITE_SUPABASE_URL",
  "api.stripe.com": "Stripe.js",
  "stripe.com": "Stripe.js subdomains (m.stripe.com, r.stripe.com)",
  "posthog.com": "posthog-js ingest and assets",
  "sentry.io": "@sentry/react ingest; DSN comes from env",
  "vercel-insights.com": "@vercel/analytics and @vercel/speed-insights",
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
