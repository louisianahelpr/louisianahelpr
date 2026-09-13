/**
 * Every sign-out goes through signOutWithPushCleanup (src/lib/authSignOut.ts),
 * which defaults to scope "local". A direct supabase.auth.signOut() call
 * inherits supabase-js's default of scope "global" and logs the account out on
 * every device, which is how a phone Log Out signed the web out (2026-09-12).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const offenders = (src: string) =>
  src
    .split("\n")
    .filter((l) => /\.auth\.signOut\s*\(/.test(l) && !/^\s*(\/\/|\*)/.test(l));

describe("sign-out goes through the scoped helper", () => {
  it("catches a direct call and ignores comments", () => {
    expect(offenders("await supabase.auth.signOut();")).toHaveLength(1);
    expect(offenders("  // `auth.signOut()` can throw")).toHaveLength(0);
  });

  it("no direct supabase.auth.signOut() outside authSignOut.ts", () => {
    const hits: string[] = [];
    (function walk(d: string) {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(n) && !/\.test\./.test(n) && p !== join("src", "lib", "authSignOut.ts"))
          for (const l of offenders(readFileSync(p, "utf8"))) hits.push(`${p}: ${l.trim()}`);
      }
    })("src");
    expect(hits, "use signOutWithPushCleanup({ scope }) instead").toEqual([]);
  });
});
