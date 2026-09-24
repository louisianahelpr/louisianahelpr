/**
 * EF-005: stripe-webhook logged the first 8 characters of every webhook signing
 * secret ("whsec_" + 2 real characters) on each invocation and on every
 * signature failure. A log line may say a secret is present and how long it
 * is, never any of its characters. Inventory: every edge function source file.
 *
 * @mutate supabase/functions/stripe-webhook/index.ts | Webhook secret loaded (length: ${webhookSecret.length}) | Webhook secret loaded (prefix: ${webhookSecret.slice(0, 8)})
 * @mutate supabase/functions/stripe-webhook/index.ts | lengths: ${webhookSecrets.map((s) => s.length).join(", ")} | ${webhookSecrets.map((s) => `${s.slice(0, 8)}`).join(", ")}
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(name) ? [p] : [];
  });
}

const files = walk("supabase/functions");
// A console call whose line slices a secret-named value, or maps over secrets
// and slices each one.
const SECRET_SLICE = /console\.\w+\(.*(?:[sS]ecret\w*\.slice\(|[sS]ecrets\.map\(\((\w+)\) => [^)]*\1\.slice\()/;

describe("edge function logs never print secret characters (EF-005)", () => {
  it("the inventory is real", () => {
    expect(files.length).toBeGreaterThan(50);
  });
  it("no console call slices a secret", () => {
    const hits = files.flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((l, i) => (SECRET_SLICE.test(l) ? `${f}:${i + 1}` : null))
        .filter(Boolean),
    );
    expect(hits).toEqual([]);
  });
});
