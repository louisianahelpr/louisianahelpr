/**
 * press-every-control's cleanup never deletes a prod-seed row.
 *
 * It deleted every row an account owned with created_at ≥ its run start. At
 * 12:53:16Z on 2026-09-24 (edge log, press run 35976390920's IP) that took the
 * poster's two Saved Helprs, which prod-audit had re-seeded ~20 minutes
 * earlier, and shell-spacing then measured an empty tab ("no section stack
 * found", profile-saved-helpers @320/375/390/430). Seed rows carry sid()'s
 * UUID version 5; press-created rows carry gen_random_uuid()'s version 4.
 */
// @mutate scripts/audit/pressProdSafety.mjs | const ids = since.map((row) => row.id).filter((id) => !isSeedRowId(id)); | const ids = since.map((row) => row.id);
// @mutate scripts/audit/prod-seed.mjs | ${h.slice(8, 12)}-5${h.slice(13, 16)} | ${h.slice(8, 12)}-4${h.slice(13, 16)}
import { describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error -- plain Node ESM with no .d.mts
import * as safety from "../../scripts/audit/pressProdSafety.mjs";

const ROOT = join(__dirname, "..", "..");

/** prod-seed.mjs's own sid(), read from its source so a change there is seen here. */
function seedSid(key: string): string {
  const src = readFileSync(join(ROOT, "scripts/audit/prod-seed.mjs"), "utf8");
  const body = /function sid\(key\) \{([\s\S]*?)\n\}/.exec(src);
  expect(body, "prod-seed.mjs no longer defines sid(key)").not.toBeNull();
  const fn = new Function("crypto", "key", body![1]) as (c: { createHash: typeof createHash }, k: string) => string;
  return fn({ createHash }, key);
}

describe("press cleanup keeps the shared seed rows", () => {
  it("tells a seed id from a press-created id", () => {
    const seed = seedSid("fav:helper");
    expect(safety.isSeedRowId(seed)).toBe(true);
    for (let i = 0; i < 20; i++) expect(safety.isSeedRowId(randomUUID())).toBe(false);
  });

  it("deletes the rows the run made and keeps the seed rows made in the same window", async () => {
    const seed = seedSid("fav:applicant01");
    const made = randomUUID();
    const deletes: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: { method?: string }) => {
      const u = String(url);
      if (init?.method === "DELETE") {
        deletes.push(u);
        return { ok: true, status: 200, text: async () => "[{}]" };
      }
      const rows = u.includes("/favorite_helpers?") ? [{ id: seed }, { id: made }] : [];
      return { ok: true, status: 200, json: async () => rows };
    }) as unknown as typeof fetch;
    try {
      await safety.cleanup({ sessions: { admin: { userId: "u1", accessToken: "t" } }, since: Date.now() - 60_000 });
    } finally {
      globalThis.fetch = realFetch;
    }
    const fav = deletes.filter((d) => d.includes("/favorite_helpers?"));
    expect(fav).toHaveLength(1);
    expect(fav[0]).toContain(made);
    expect(fav[0], "cleanup deleted a prod-seed row").not.toContain(seed);
    expect(fav[0], "the delete is still scoped to the signed-in owner").toContain("customer_id=eq.u1");
    expect(deletes.length, "tables with nothing new send no DELETE").toBe(1);
  });
});
