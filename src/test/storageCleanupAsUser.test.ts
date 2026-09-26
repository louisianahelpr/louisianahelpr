/**
 * #1582 (press-every-control run 36069319716, shard 4): the press cleanup
 * removed NO files from its four fixture jobs, "[press cleanup] storage
 * removal incomplete (0 removed)", every prefix failing "GET /bucket/job-photos
 * -> HTTP 400 Bucket not found".
 *
 * removePrefixes (scripts/lib/jobMediaRest.mjs) GETs each bucket first so a
 * missing bucket fails loudly (Q219). Storage answers that GET with
 * NoSuchBucket to ANY non-service-role token, for every bucket: measured
 * 2026-09-25 as anon, avatars / proof-photos / job-photos / no-such-bucket-xyz
 * all identical. So every caller that runs as a user session (the press
 * cleanup, scripts/e2e/prod-lifecycle-sweeper.mjs) failed every prefix and
 * removed nothing, and the weekly orphan sweep was the only thing cleaning up.
 *
 * The probe now runs only for a caller that can read bucket metadata; a user
 * caller lists and deletes. Q219's own guard (purgeBucketsAreDeclared) keeps
 * the service-role half.
 *
 * @mutate scripts/lib/jobMediaRest.mjs |   const probeBuckets = callerReadsBuckets(headers); |   const probeBuckets = true;
 * @mutate scripts/lib/jobMediaRest.mjs |   if (bearer.startsWith("sb_secret_")) return true; |
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { callerReadsBuckets, removePrefixes } from "../../scripts/lib/jobMediaRest.mjs";

const ROOT = resolve(__dirname, "..", "..");
const J = "fde2605b-1111-4111-8111-111111111111";
const jwt = (role: string) => `h.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.s`;

/** A Storage that behaves as prod does for a NON-service caller. */
const userStorage = (calls: string[]) =>
  vi.stubGlobal("fetch", async (url: string, init: { method: string; body?: string }) => {
    calls.push(`${init.method} ${url.replace("https://example.test/storage/v1", "")}`);
    if (init.method === "GET") return new Response('{"statusCode":"404","error":"Bucket not found"}', { status: 400 });
    if (init.method === "POST" && url.includes("/object/list/")) {
      const { prefix } = JSON.parse(init.body ?? "{}");
      if (prefix === "") return new Response(JSON.stringify([{ name: J, id: null }]), { status: 200 });
      if (prefix === J) return new Response(JSON.stringify([{ name: "before-1.png", id: "o1" }]), { status: 200 });
      return new Response("[]", { status: 200 });
    }
    if (init.method === "DELETE") return new Response(JSON.stringify([{ name: `${J}/before-1.png` }]), { status: 200 });
    return new Response("[]", { status: 200 });
  });

afterEach(() => vi.unstubAllGlobals());

describe("storage cleanup as a user session (#1582)", () => {
  it("a user-token caller removes its job's files instead of failing on the bucket probe", async () => {
    const calls: string[] = [];
    userStorage(calls);
    const out = await removePrefixes({
      base: "https://example.test",
      headers: { apikey: "sb_publishable_x", Authorization: `Bearer ${jwt("authenticated")}` },
      prefixes: [{ bucket: "proof-photos", prefix: J }],
      source: "test",
    });
    expect(calls.filter((c) => c.startsWith("GET /bucket/"))).toEqual([]);
    expect(out).toEqual({ removed: 1, failures: [] });
  });

  it("only the service role's bucket GET is treated as evidence", () => {
    expect(callerReadsBuckets({ Authorization: `Bearer ${jwt("service_role")}` })).toBe(true);
    expect(callerReadsBuckets({ Authorization: `Bearer sb_secret_${"x".repeat(20)}` })).toBe(true);
    expect(callerReadsBuckets({ Authorization: `Bearer ${jwt("authenticated")}` })).toBe(false);
    expect(callerReadsBuckets({ Authorization: `Bearer ${jwt("anon")}` })).toBe(false);
    expect(callerReadsBuckets({})).toBe(false);
  });

  it("the user-session callers are among the scripts that remove job media (inventory)", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.mjs$/.test(f)) files.push(p);
      }
    };
    walk(resolve(ROOT, "scripts"));
    const callers = files.filter((f) => /\bremove(JobMedia|UserStorage|MessageAttachments)Rest\s*\(/.test(blankComments(readFileSync(f, "utf8"))) && !f.endsWith("jobMediaRest.mjs"));
    // Floor, measured 2026-09-25: prod-seed, pressProdSafety, prod-lifecycle-sweeper, prod-audit-sweeper.
    expect(callers.length).toBeGreaterThanOrEqual(4);
    // The two that run as the test POSTER's session, which this fix is for.
    const rel = callers.map((f) => f.replace(ROOT + "/", ""));
    expect(rel).toEqual(expect.arrayContaining(["scripts/audit/pressProdSafety.mjs", "scripts/e2e/prod-lifecycle-sweeper.mjs"]));
  });
});
