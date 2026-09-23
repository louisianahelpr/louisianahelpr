import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  LIVE_PROD_ALLOWLIST,
  isGuardedHost,
  takeRecordedLeaks,
} from "./prodNetworkGuard";

/**
 * Q55(a): unit tests sent ~4,190 requests/day to PROD Supabase
 * (`thread_archives?user_id=eq.user-1`, `thread_pins?user_id=eq.user-1`,
 * user-agent `node`) because a Messages spec rendered the real
 * archivedConversations / pinnedConversations modules unmocked.
 * src/test/prodNetworkGuard.ts (installed by setup.ts) refuses and records
 * every Supabase request; this proves the guard fires on exactly that planted
 * call, and keeps the live-test allowlist exact in both directions.
 */

// @mutate src/test/prodNetworkGuard.ts | if (!isGuardedHost(url) \|\| specIsAllowed(spec)) return null; | return null;
// @mutate src/test/setup.ts | installProdNetworkGuard();\n |
// @mutate vitest.config.ts | VITE_SUPABASE_URL: "https://unit-test.invalid", | VITE_SUPABASE_URL: "https://fncmgoasalhdgfwzhsqa.supabase.co",

const REPO_ROOT = resolve(__dirname, "..", "..");

function walkSpecs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "node_modules") walkSpecs(p, out);
    } else if (/\.(test|spec)\.(ts|tsx)$/.test(name)) {
      out.push(relative(REPO_ROOT, p));
    }
  }
  return out;
}

// A real `// @live-prod: <reason>` comment line, not a mention inside prose.
const MARKER_LINE = /^\s*\/\/\s*@live-prod:\s*\S/m;

describe("prodNetworkGuard (Q55a)", () => {
  it("refuses the planted leak: real loadArchives()/loadPins() for user-1, unmocked", async () => {
    const { loadArchives } = await import("@/lib/archivedConversations");
    const { loadPins } = await import("@/lib/pinnedConversations");
    // Exactly the calls prod logged. Both modules swallow the network error
    // and fall back to their local mirror, so the only evidence is the record.
    await loadArchives("user-1").catch(() => undefined);
    await loadPins("user-1").catch(() => undefined);
    const leaks = takeRecordedLeaks();
    expect(leaks.some((l) => /thread_archives/.test(l) && /user-1/.test(l))).toBe(true);
    expect(leaks.some((l) => /thread_pins/.test(l) && /user-1/.test(l))).toBe(true);
    expect(leaks.every((l) => l.includes("src/test/prodNetworkGuard.test.ts"))).toBe(true);
  });

  it("rejects a raw fetch to a *.supabase.co host with an Error naming URL and spec", async () => {
    const url = "https://planted-leak.supabase.co/rest/v1/thread_pins?user_id=eq.user-1";
    await expect(fetch(url)).rejects.toThrow(/prodNetworkGuard.*planted-leak\.supabase\.co.*prodNetworkGuard\.test\.ts/s);
    expect(takeRecordedLeaks()).toHaveLength(1);
  });

  it("guards Supabase hosts and the configured client URL, and nothing else", () => {
    expect(isGuardedHost("https://fncmgoasalhdgfwzhsqa.supabase.co/rest/v1/jobs")).toBe(true);
    expect(isGuardedHost("wss://fncmgoasalhdgfwzhsqa.supabase.co/realtime/v1/websocket")).toBe(true);
    expect(isGuardedHost(String(import.meta.env.VITE_SUPABASE_URL) + "/rest/v1/jobs")).toBe(true);
    expect(isGuardedHost("https://api.stripe.com/v1/charges")).toBe(false);
    expect(isGuardedHost("https://notsupabase.co/x")).toBe(false);
    expect(isGuardedHost("not a url")).toBe(false);
  });

  it("unit tests point the Supabase client at an unroutable host, never prod", () => {
    const url = new URL(String(import.meta.env.VITE_SUPABASE_URL));
    expect(url.hostname.endsWith(".invalid")).toBe(true);
    const cfg = readFileSync(resolve(REPO_ROOT, "vitest.config.ts"), "utf8");
    expect(cfg).not.toMatch(/VITE_SUPABASE_URL:\s*"https:\/\/[a-z0-9]+\.supabase\.co"/);
  });

  it("the @live-prod allowlist is exact: every marked spec is listed and every listed spec is marked", () => {
    const specs = walkSpecs(resolve(REPO_ROOT, "src"));
    expect(specs.length).toBeGreaterThan(500);
    const marked = specs
      .filter((f) => MARKER_LINE.test(readFileSync(resolve(REPO_ROOT, f), "utf8")))
      .sort();
    const listed = Object.keys(LIVE_PROD_ALLOWLIST).sort();
    for (const f of listed) expect(marked, `stale LIVE_PROD_ALLOWLIST entry ${f} — remove it`).toContain(f);
    for (const f of marked) expect(listed, `${f} carries @live-prod: but is not in LIVE_PROD_ALLOWLIST`).toContain(f);
    expect(marked).toEqual(listed);
    for (const reason of Object.values(LIVE_PROD_ALLOWLIST)) expect(reason.trim().length).toBeGreaterThan(20);
  });
});
