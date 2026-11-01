/**
 * The build swaps @supabase/auth-js's passkey and Sign-In with Ethereum helpers for a stand-in (B86, 11-01;
 * vite.config.ts plugin "auth-js-no-passkeys", src/vendorStubs/authJsPasskeyStub.ts): 4.2 KB gz off the supabase
 * chunk every page boots with. This holds the three things that make that safe.
 *
 * 1. The stand-in exports every name GoTrueClient imports from those two modules (read from the installed
 *    package, so a supabase-js upgrade that imports a new one fails here as well as in the build).
 * 2. Nothing in the app signs in with a passkey or a wallet, or enrolls a WebAuthn factor (Helpr's two-factor
 *    is TOTP). Adding one of those means deleting the plugin, not extending the stub.
 * 3. The plugin is registered and points at the stub.
 *
 * @mutate src/vendorStubs/authJsPasskeyStub.ts | export const getCredential = unsupported; | const getCredential = unsupported;
 * @mutate vite.config.ts |     authJsNoPasskeys(),\n | \n
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const root = process.cwd();
const gotrue = readFileSync(resolve(root, "node_modules/@supabase/auth-js/dist/module/GoTrueClient.js"), "utf8");
const stub = blankComments(readFileSync(resolve(root, "src/vendorStubs/authJsPasskeyStub.ts"), "utf8"));
const config = blankComments(readFileSync(resolve(root, "vite.config.ts"), "utf8"));

const importedFrom = (spec: string) => {
  const m = gotrue.match(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*'${spec.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}'`));
  return (m?.[1] ?? "").split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
};
const stubExports = new Set([...stub.matchAll(/^export (?:const|class|function) (\w+)/gm)].map((m) => m[1]));

describe("auth-js passkey stand-in", () => {
  const names = [...importedFrom("./lib/webauthn"), ...importedFrom("./lib/web3/ethereum")];

  it("finds GoTrueClient's imports", () => {
    expect(names.length).toBeGreaterThan(8);
  });

  it.each(names)("exports %s", (name) => {
    expect(stubExports.has(name)).toBe(true);
  });

  it("the build plugin is registered and resolves to the stub", () => {
    expect(config).toMatch(/^\s*authJsNoPasskeys\(\),$/m);
    expect(config).toMatch(/src\/vendorStubs\/authJsPasskeyStub\.ts/);
    expect(config).toMatch(/"\.\/lib\/webauthn", "\.\/lib\/web3\/ethereum"/);
  });

  it("no app code uses passkeys, WebAuthn factors or wallet sign-in", () => {
    const hits: string[] = [];
    let files = 0;
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const name = entry.name;
        const p = join(dir, name);
        if (entry.isDirectory()) {
          if (name !== "test" && name !== "vendorStubs") walk(p);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
        files++;
        const src = blankComments(readFileSync(p, "utf8"));
        if (/signInWithWeb3|signInWithPasskey|registerPasskey|mfa\.webauthn|factorType:\s*["']webauthn["']|auth\.passkey/.test(src)) hits.push(p);
      }
    };
    walk(resolve(root, "src"));
    expect(files).toBeGreaterThan(500);
    expect(hits).toEqual([]);
  });
});
