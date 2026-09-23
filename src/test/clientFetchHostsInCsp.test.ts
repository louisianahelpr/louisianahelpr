/**
 * Q319: W9CollectionDialog fetched https://api.ipify.org, a host the CSP's
 * connect-src does not allow, so the request was blocked in every browser and
 * the "best-effort" catch hid it: no W-9 signature ever carried an IP.
 *
 * Class check: every literal absolute URL a src/ file passes to fetch() must be
 * allowed by connect-src in BOTH vercel.json (prod) and index.html (the meta
 * tag native builds run under).
 *
 * @mutate src/lib/hibpCheck.ts | fetch(`https://api.pwnedpasswords.com | fetch(`https://api.ipify.org
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    if (statSync(p).isDirectory()) return n === "test" ? [] : walk(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });

const connectSrc = (text: string, where: string): string[] => {
  const m = text.match(/connect-src([^;"]*)/);
  if (!m) throw new Error(`no connect-src in ${where}`);
  return m[1].trim().split(/\s+/);
};
const allows = (sources: string[], host: string) =>
  sources.some((s) => {
    const h = s.replace(/^(https?|wss?):\/\//, "").replace(/\/.*$/, "");
    if (h.startsWith("*.")) return host.endsWith(h.slice(1));
    return h === host;
  });

const CSPS: Array<[string, string[]]> = [
  ["vercel.json", connectSrc(readFileSync(join(ROOT, "vercel.json"), "utf8"), "vercel.json")],
  ["index.html", connectSrc(readFileSync(join(ROOT, "index.html"), "utf8"), "index.html")],
];

const fetched = walk(SRC).flatMap((f) =>
  [...blankComments(readFileSync(f, "utf8")).matchAll(/\bfetch\(\s*["'`]https:\/\/([^/"'`?$]+)/g)].map((m) => ({
    file: f.slice(ROOT.length + 1),
    host: m[1],
  })),
);

describe("client fetches only hosts the CSP allows (Q319)", () => {
  it("finds the client's absolute fetches", () => {
    expect(fetched.length).toBeGreaterThan(0);
  });

  for (const [where, sources] of CSPS) {
    it(`every fetched host is in ${where} connect-src`, () => {
      expect(fetched.filter((x) => !allows(sources, x.host))).toEqual([]);
    });
  }
});
