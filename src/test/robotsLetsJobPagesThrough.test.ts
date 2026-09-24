/**
 * A shared job link (/jobs/<id>) must stay fetchable: api/share.ts's link
 * preview needs the OS to get past robots.txt (see the note in that file).
 * The Jobs tab moved to /jobs on 2026-09-24, and its `Disallow: /jobs` is a
 * prefix of every job page, so this evaluates robots.txt the way RFC 9309
 * says a crawler must (longest matching rule wins, Allow wins a tie) and
 * asserts the answer for real paths, not for the text of one line.
 */
// @mutate public/robots.txt | Allow: /jobs/ | Allow: /jobz/
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const rules = readFileSync(join(__dirname, "..", "..", "public", "robots.txt"), "utf8")
  .split("\n")
  .map((l) => l.replace(/#.*/, "").trim())
  .map((l) => /^(allow|disallow):\s*(\S*)$/i.exec(l))
  .filter((m): m is RegExpExecArray => !!m && m[2] !== "")
  .map((m) => ({ allow: m[1].toLowerCase() === "allow", path: m[2] }));

function allowed(path: string): boolean {
  const hits = rules.filter((r) => path.startsWith(r.path));
  if (hits.length === 0) return true;
  const best = Math.max(...hits.map((r) => r.path.length));
  return hits.some((r) => r.path.length === best && r.allow);
}

describe("robots.txt", () => {
  it("parses real rules", () => {
    expect(rules.length).toBeGreaterThan(5);
  });
  it("lets a shared job page through", () => {
    expect(allowed("/jobs/3f0c9a4e-0000-4000-8000-000000000000")).toBe(true);
  });
  it("still keeps the signed-in tabs out", () => {
    for (const p of ["/home", "/posts", "/jobs", "/messages", "/profile"]) expect(allowed(p), p).toBe(false);
  });
});
