/**
 * Q249: no MapKit JS token is ever compiled into the app or committed.
 *
 * MapKit used to fall back to `VITE_APPLE_MAPKIT_TOKEN`, a static ES256 token
 * with NO origin claim and a 2027-02-14 expiry. A VITE_ value is inlined into
 * the bundle, so the iOS builds (deploy.yml / ios-beta.yml passed the GitHub
 * secret) shipped an unrestricted credential anyone could lift out, and the
 * token itself sat in .env.example in this public repo. Measured 2026-10-12:
 * the live web bundle (321 files from https://www.louisianahelpr.com) carried
 * no MapKit JWT (Vercel had no such env), while the GitHub secret was set.
 *
 * The only source now is the `mapkit-token` edge function (one hour,
 * origin-locked on the web; src/test/edge/mapkit-token.test.ts). This guard
 * keeps the static token from coming back by any of its three routes:
 *   1. app code reading the env var (Vite would inline it);
 *   2. a workflow handing the secret to a build;
 *   3. a token literal in any tracked file.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankHashComments } from "./helpers/blankNonCode";

const ROOT = process.cwd();
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 })
  .split("\0")
  .filter(Boolean);
const read = (f: string): string | null => {
  try {
    return readFileSync(join(ROOT, f), "utf8");
  } catch {
    return null; // deleted in the working tree: cannot be an offender
  }
};
const isTest = (f: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) || f.startsWith("src/test/");

describe("the static MapKit token never ships (Q249)", () => {
  // @mutate src/hooks/useMapKitJs.ts |   setTokenSource("none");\n  return undefined; |   setTokenSource("none");\n  return import.meta.env.VITE_APPLE_MAPKIT_TOKEN \|\| undefined;
  it("no app code reads VITE_APPLE_MAPKIT_TOKEN (Vite would compile it into the bundle)", () => {
    const app = tracked.filter((f) => f.startsWith("src/") && /\.[cm]?[jt]sx?$/.test(f) && !isTest(f));
    expect(app.length).toBeGreaterThan(500);
    const readers = app.filter((f) => /VITE_APPLE_MAPKIT_TOKEN/.test(blankComments(read(f) ?? "")));
    expect(readers).toEqual([]);
  });

  // @mutate .github/workflows/ios-beta.yml |           VITE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.VITE_SUPABASE_PUBLISHABLE_KEY }} |           VITE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.VITE_SUPABASE_PUBLISHABLE_KEY }}\n          VITE_APPLE_MAPKIT_TOKEN: ${{ secrets.VITE_APPLE_MAPKIT_TOKEN }}
  it("no workflow hands the token to a build", () => {
    const workflows = tracked.filter((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f));
    expect(workflows.length).toBeGreaterThan(20);
    const passing = workflows.filter((f) => /VITE_APPLE_MAPKIT_TOKEN/.test(blankHashComments(read(f) ?? "")));
    expect(passing).toEqual([]);
  });

  // Apple's MapKit JS tokens are ES256 JWTs with a `kid` header: base64url of
  // {"alg":"ES256","kid": opens with this prefix. Tests build fakes at runtime.
  // @mutate .env.example | VITE_SUPABASE_PROJECT_ID="fncmgoasalhdgfwzhsqa" | VITE_SUPABASE_PROJECT_ID="fncmgoasalhdgfwzhsqa"\nVITE_APPLE_MAPKIT_TOKEN="eyJhbGciOiJFUzI1NiIsImtpZCI6IjRRQThKOVRBOEsiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJQODVNQ0s1NThWIn0.c2ln"
  it("no tracked file holds an ES256 token literal", () => {
    const text = tracked.filter((f) => !isTest(f) && !/\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|mp4|mov|zip|gz|p12|mobileprovision|car)$/i.test(f));
    expect(text.length).toBeGreaterThan(2_000);
    const holders = text.filter((f) => /eyJhbGciOiJFUzI1NiIsImtpZCI6[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(read(f) ?? ""));
    expect(holders).toEqual([]);
  });
});
