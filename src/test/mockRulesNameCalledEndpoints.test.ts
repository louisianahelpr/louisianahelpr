/**
 * Q1019 — a mocked endpoint is one the app actually calls.
 *
 * The mocked happy-path harness answers named tables and RPCs
 * (`mockTable("x", rows)`, `mockRpc("y", ...)` in e2e/). A rule for an endpoint
 * no src/ file calls cannot be exercised: it documents behaviour the app does
 * not have, and when the app's real call is renamed the spec keeps "passing"
 * on the dead rule. Found 2026-10-05: `mockTable("job_checkins", [])` in
 * customer-post-job and customer-sees-application, a table no client code
 * reads (it left the realtime publication in Q105); removed.
 *
 * Inventory from source, both sides: every mockTable / mockRpc name under e2e/
 * against every `.from("t")` / `.rpc("f")` in non-test src/ files. Exempt
 * entries need a reason and are two-way. (The mocked specs themselves are being
 * migrated to prod or retired, Q1035; this keeps the ones left honest.)
 */
// @mutate e2e/happy-path/customer-post-job.spec.ts |         mockTable("tips", []), |         mockTable("tips", []),\n        mockTable("job_checkins", []),
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");

/** Mocked names no src/ file calls, and why the rule must stay. */
const MOCKED_BUT_UNCALLED: Record<string, string> = {};

const rel = (abs: string) => abs.slice(ROOT.length + 1);
const code = (abs: string) => blankComments(readFileSync(abs, "utf8"));

function mocked(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of walkSource([join(ROOT, "e2e")], [".ts", ".tsx"])) {
    for (const m of code(f).matchAll(/\bmock(Table|Rpc)\(\s*["']([a-z_0-9]+)["']/g)) {
      const key = `${m[1] === "Table" ? "table" : "rpc"}:${m[2]}`;
      out.set(key, [...(out.get(key) ?? []), rel(f)]);
    }
  }
  return out;
}

function called(): Set<string> {
  const out = new Set<string>();
  for (const f of walkSource([join(ROOT, "src")], [".ts", ".tsx"])) {
    if (/\.test\.|\/src\/test\//.test(f)) continue;
    const c = code(f);
    for (const m of c.matchAll(/\.from\(\s*["']([a-z_0-9]+)["']/g)) out.add(`table:${m[1]}`);
    for (const m of c.matchAll(/\.rpc\(\s*["']([a-z_0-9]+)["']/g)) out.add(`rpc:${m[1]}`);
  }
  return out;
}

describe("mock rules name endpoints the app calls (Q1019)", () => {
  const mocks = mocked();
  const calls = called();

  it("both inventories are real", () => {
    expect(mocks.size).toBeGreaterThan(10);
    expect([...calls].filter((k) => k.startsWith("table:")).length).toBeGreaterThan(30);
    expect([...calls].filter((k) => k.startsWith("rpc:")).length).toBeGreaterThan(30);
    expect(calls.has("table:applications")).toBe(true);
  });

  it("every mocked table and RPC is one some src/ file calls", () => {
    const dead = [...mocks.keys()].filter((k) => !calls.has(k) && !(k in MOCKED_BUT_UNCALLED)).map((k) => `${k} (${mocks.get(k)!.join(", ")})`);
    expect(dead).toEqual([]);
  });

  it("the exemption list is exact", () => {
    for (const k of Object.keys(MOCKED_BUT_UNCALLED)) {
      expect(mocks.has(k), k).toBe(true);
      expect(calls.has(k), k).toBe(false);
    }
  });
});
