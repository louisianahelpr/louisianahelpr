/**
 * The build swaps @supabase/auth-js's GoTrueAdminApi for a stand-in that keeps only signOut (B87, 11-01;
 * src/vendorStubs/authJsAdminStub.ts, vite.config.ts plugin "auth-js-no-passkeys"): 1.4 KB gz off the supabase chunk
 * every page boots with. Signing out must still end the session on the server, so this holds:
 *
 * 1. The stand-in's signOut is the installed package's, statement for statement (types aside), so an auth-js upgrade
 *    that changes it fails here.
 * 2. GoTrueClient still reaches the admin API only through `this.admin.signOut` (anything new means re-checking).
 * 3. Nothing in the app calls `auth.admin` (it needs the service-role key, which never ships).
 * 4. The plugin points GoTrueClient's import at the stand-in.
 *
 * @mutate src/vendorStubs/authJsAdminStub.ts |         noResolveJson: true, |         noResolveJson: false,
 * @mutate src/vendorStubs/authJsAdminStub.ts |       if (isAuthError(error)) { |       if (error) {
 * @mutate src/hooks/useDeleteAccount.ts | import { useRef, useState } from "react"; | import { useRef, useState } from "react";\nconst probeAdmin = (c: { auth: { admin: unknown } }) => c.auth.admin;\nvoid probeAdmin;
 * @mutate vite.config.ts |     if (source === "./GoTrueAdminApi") return path.resolve(__dirname, "src/vendorStubs/authJsAdminStub.ts"); |     if (source === "./GoTrueAdminApiX") return path.resolve(__dirname, "src/vendorStubs/authJsAdminStub.ts");
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import RealAdmin from "@supabase/auth-js/dist/module/GoTrueAdminApi";
import StubAdmin from "@/vendorStubs/authJsAdminStub";

const root = process.cwd();
const mod = (f: string) => readFileSync(resolve(root, "node_modules/@supabase/auth-js/dist/module", f), "utf8");
const stub = blankComments(readFileSync(resolve(root, "src/vendorStubs/authJsAdminStub.ts"), "utf8"));
const config = blankComments(readFileSync(resolve(root, "vite.config.ts"), "utf8"));

/** A method's body from `async signOut(` to its closing brace at the method's indent, normalised. */
function signOutBody(src: string): string {
  const at = src.indexOf("async signOut(");
  expect(at).toBeGreaterThan(0);
  const open = src.indexOf("{", src.indexOf(")", at));
  let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}" && --depth === 0) break; }
  return src.slice(open, i + 1).replace(/\s+/g, "").replace(/"/g, "'");
}

describe("auth-js admin stand-in", () => {
  it("keeps the installed package's signOut", () => {
    const real = signOutBody(blankComments(mod("GoTrueAdminApi.js")));
    expect(real.length).toBeGreaterThan(200);
    expect(signOutBody(stub)).toBe(real);
  });

  it("sends the same logout request as the real one, and reads a 401 the same way", async () => {
    const run = async (Admin: typeof StubAdmin, status: number) => {
      const calls: [string, RequestInit][] = [];
      const fetch = (async (url: string, init: RequestInit) => { calls.push([url, init]); return new Response(status === 204 ? null : "{}", { status }); }) as unknown as typeof globalThis.fetch;
      const admin = new Admin({ url: "https://x.test/auth/v1", headers: { apikey: "k" }, fetch });
      const out = await admin.signOut("jwt-1", "local");
      const [url, init] = calls[0];
      const h = new Headers(init.headers);
      return { n: calls.length, url, method: init.method, auth: h.get("authorization"), apikey: h.get("apikey"), error: out.error ? (out.error as { status?: number }).status : null };
    };
    for (const status of [204, 401]) {
      const stub = await run(StubAdmin, status);
      expect(stub).toEqual(await run(RealAdmin as unknown as typeof StubAdmin, status));
      expect(stub.url).toBe("https://x.test/auth/v1/logout?scope=local");
      expect(stub.auth).toBe("Bearer jwt-1");
    }
  });

  it("GoTrueClient uses the admin API only for signOut", () => {
    const client = mod("GoTrueClient.js");
    expect(client).toContain("import GoTrueAdminApi from './GoTrueAdminApi';");
    const uses = [...client.matchAll(/this\.admin\.(\w+)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    expect([...new Set(uses)]).toEqual(["signOut"]);
  });

  it("nothing in the app calls auth.admin", () => {
    // Every file that names auth.admin at all (today: two comments), then only real code calls.
    const named = execFileSync("git", ["grep", "-lF", "auth.admin", "--", "src"], { encoding: "utf8", cwd: root }).split("\n").filter(Boolean)
      .filter((f) => !/\.test\.|src\/test\//.test(f));
    expect(named.length).toBeGreaterThan(0);
    const calls = named.filter((f) => /auth\.admin\b/.test(blankComments(readFileSync(resolve(root, f), "utf8"))));
    expect(calls).toEqual([]);
  });

  it("the plugin points GoTrueClient's import at the stand-in", () => {
    expect(config).toContain('if (source === "./GoTrueAdminApi") return path.resolve(__dirname, "src/vendorStubs/authJsAdminStub.ts");');
    expect(config).toMatch(/authJsNoPasskeys\(\),/);
  });
});
