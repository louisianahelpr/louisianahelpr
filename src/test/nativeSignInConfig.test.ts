/**
 * GUARD (docs/OPEN.md Q1323 part 1): every Apple / Google client id the app's
 * sign-in code passes is one prod Supabase Auth accepts.
 *
 * On 2026-10-05 the lead measured prod's /config/auth: external_apple_client_id
 * held only the Services ID (a native iOS Apple token's `aud` is the App ID
 * com.Helpr, so it was refused), external_google_client_id only the web client
 * (the iOS client's token was refused), skip_nonce_check was false, and the web
 * Google client was a DESKTOP client (Error 400 redirect_uri_mismatch).
 *
 * The LIVE half is scripts/check-native-sign-in-config.mjs, nightly in
 * .github/workflows/db-drift-detect.yml; its fail-closed cases (no
 * credentials, a 500, an empty answer, a config without the App ID) run in
 * src/test/liveCheckScriptsFailClosed.test.ts. This file proves the pure part:
 * the ids are DERIVED from the real source (never a second hand-typed copy),
 * the sources agree with one another, and every config rule fails on the
 * config it exists to catch.
 */
// @mutate scripts/lib/nativeSignInIds.mjs | add(apple.includes(b.id), | add(true,
// @mutate scripts/lib/nativeSignInIds.mjs | add(apple.includes(a.id), | add(true,
// @mutate scripts/lib/nativeSignInIds.mjs |     !nativeIds.has(first) && |
// @mutate scripts/lib/nativeSignInIds.mjs | typeof first === "string" && !first.startsWith(OLD_DESKTOP_GOOGLE_PREFIX), | true,
// @mutate scripts/lib/nativeSignInIds.mjs | add(at >= 1, | add(at !== -1,
// @mutate scripts/lib/nativeSignInIds.mjs | config.external_google_skip_nonce_check === true, | true,
// @mutate scripts/lib/nativeSignInIds.mjs | add(config[key] === true, | add(true,
// @mutate scripts/lib/nativeSignInIds.mjs |     if (id !== appId) problems.push( |     if (false) problems.push(
// @mutate src/lib/socialAuth.ts | iOSClientId: | iosClientIdent:
// @mutate src/lib/socialAuth.ts | apple: { clientId: "com.Helpr.signin" }, | apple: { serviceId: "com.Helpr.signin" },
// @mutate capacitor.config.ts | appId: 'com.Helpr', | appId: 'com.Helpr.app',
// @mutate ios/App/App/Info.plist | <string>com.googleusercontent.apps. | <string>com.googleusercontent.appz.
// @mutate .github/workflows/db-drift-detect.yml | NATIVE_SIGN_IN: ${{ steps.native_sign_in.outcome }} | NATIVE_SIGN_IN: success
// @mutate .github/workflows/db-drift-detect.yml | run: node scripts/check-native-sign-in-config.mjs | run: "true"
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  OLD_DESKTOP_GOOGLE_PREFIX,
  checkAuthConfig,
  deriveSignInIds,
  readSignInSources,
  type SignInIds,
} from "../../scripts/lib/nativeSignInIds.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const SRC = readSignInSources(ROOT);
// The id rules are what applies when Apple/Google sign-in is ON; the real
// source has it OFF for launch (Q1425), which the last describe covers.
const IDS = { ...deriveSignInIds(SRC), socialEnabled: true };

/** A web client id that is none of the app's (a fixture, not a copy of a real id). */
const WEB = "111111111111-fixtureweb.apps.googleusercontent.com";

/** The config prod should hold, built FROM the derived ids. */
function goodConfig(ids: SignInIds = IDS): Record<string, unknown> {
  const native = [...new Set(ids.googleNative.map((g) => g.id))];
  return {
    external_apple_enabled: true,
    external_google_enabled: true,
    external_apple_client_id: [...ids.appleServiceIds, ...ids.bundleIds].map((x) => x.id).join(","),
    external_google_client_id: [WEB, ...native].join(","),
    external_google_skip_nonce_check: true,
  };
}
const failing = (config: Record<string, unknown>) => checkAuthConfig(config, IDS).filter((r) => !r.ok).map((r) => r.check);

describe("the ids are derived from the shipped source", () => {
  it("reads the Services ID, the App ID and the native Google client from every source that carries one (floor)", () => {
    expect(IDS.appleServiceIds.length).toBeGreaterThanOrEqual(1);
    expect(IDS.appleServiceIds.every((a) => a.from.startsWith("src/lib/socialAuth.ts"))).toBe(true);
    const appId = /\bappId\s*:\s*'([^']+)'/.exec(SRC.capacitor)?.[1];
    expect(appId).toBeTruthy();
    expect(IDS.bundleIds.map((b) => b.id)).toContain(appId);
    // The iOS client comes from socialAuth.ts AND from Info.plist's reversed URL scheme.
    expect(IDS.googleNative.length).toBeGreaterThanOrEqual(2);
    expect(IDS.googleNative.some((g) => g.from === "src/lib/socialAuth.ts google.iOSClientId")).toBe(true);
    expect(IDS.googleNative.some((g) => g.from.startsWith("ios/App/App/Info.plist URL scheme"))).toBe(true);
    expect(IDS.providers).toMatchObject({ apple: true, google: true });
  });

  it("the sources agree: Info.plist returns to the iOS client socialAuth.ts passes, and Xcode signs capacitor's appId", () => {
    expect(IDS.problems).toEqual([]);
  });

  it("the CLI's comment handling derives exactly what blankComments does", () => {
    expect({ ...deriveSignInIds(SRC, blankComments), socialEnabled: true }).toEqual(IDS);
  });

  it("an id that only appears in a comment is not derived", () => {
    const socialAuth = SRC.socialAuth.replace(
      "SocialLogin.initialize({",
      'SocialLogin.initialize({\n    // webClientId: "999999999999-commented.apps.googleusercontent.com",',
    );
    expect(socialAuth).not.toBe(SRC.socialAuth);
    const ids = deriveSignInIds({ ...SRC, socialAuth }, blankComments);
    expect(ids.googleWeb).toEqual([]);
    expect(ids.googleNative.map((g) => g.id)).not.toContain("999999999999-commented.apps.googleusercontent.com");
  });

  it("a source that drifted apart is a problem, not a pass", () => {
    const plist = SRC.infoPlist.replace(/com\.googleusercontent\.apps\.\d+-[a-z0-9]+/, "com.googleusercontent.apps.222222222222-other");
    expect(plist).not.toBe(SRC.infoPlist);
    expect(deriveSignInIds({ ...SRC, infoPlist: plist }).problems.length).toBeGreaterThanOrEqual(2);
    const cap = SRC.capacitor.replace(/appId:\s*'[^']+'/, "appId: 'com.example.other'");
    expect(deriveSignInIds({ ...SRC, capacitor: cap }).problems.join("\n")).toMatch(/PRODUCT_BUNDLE_IDENTIFIER .* differs from capacitor\.config\.ts appId/);
  });

  it("refuses to derive nothing: a source without the initialize call throws", () => {
    expect(() => deriveSignInIds({ ...SRC, socialAuth: "export {};" })).toThrow(/no SocialLogin\.initialize/);
    expect(() => deriveSignInIds({ ...SRC, pbxproj: "" })).toThrow(/no PRODUCT_BUNDLE_IDENTIFIER/);
  });
});

describe("every config rule fails on the config it exists to catch", () => {
  it("the config built from the source passes every check (floor)", () => {
    const results = checkAuthConfig(goodConfig(), IDS);
    expect(results.length).toBeGreaterThanOrEqual(8);
    expect(results.filter((r) => !r.ok)).toEqual([]);
  });

  it("the App ID (bundle) missing from the Apple list fails", () => {
    for (const b of IDS.bundleIds) {
      const cfg = goodConfig();
      cfg.external_apple_client_id = String(cfg.external_apple_client_id).split(",").filter((x) => x !== b.id).join(",");
      expect(failing(cfg)).toEqual([`external_apple_client_id includes the App ID (bundle) ${b.id}`]);
    }
  });

  it("the Services ID missing from the Apple list fails", () => {
    const cfg = goodConfig();
    const svc = IDS.appleServiceIds[0].id;
    cfg.external_apple_client_id = String(cfg.external_apple_client_id).split(",").filter((x) => x !== svc).join(",");
    expect(failing(cfg)).toEqual([`external_apple_client_id includes ${svc}`]);
  });

  it("a native Google client listed first (web not first) fails", () => {
    const cfg = goodConfig();
    const native = [...new Set(IDS.googleNative.map((g) => g.id))];
    cfg.external_google_client_id = [...native, WEB].join(",");
    expect(failing(cfg)).toEqual([
      "external_google_client_id lists the WEB client first",
      `external_google_client_id lists native client ${native[0]} after the web client`,
    ]);
  });

  it("the old Desktop client listed first fails", () => {
    const cfg = goodConfig();
    cfg.external_google_client_id = String(cfg.external_google_client_id).replace(WEB, `${OLD_DESKTOP_GOOGLE_PREFIX}fixture.apps.googleusercontent.com`);
    expect(failing(cfg)).toEqual([`the first Google client id is not the old Desktop client ${OLD_DESKTOP_GOOGLE_PREFIX}...`]);
  });

  it("a native Google client missing from the list fails", () => {
    const cfg = goodConfig();
    cfg.external_google_client_id = WEB;
    const native = [...new Set(IDS.googleNative.map((g) => g.id))];
    expect(failing(cfg)).toEqual(native.map((id) => `external_google_client_id lists native client ${id} after the web client`));
  });

  it("skip_nonce_check off or absent fails", () => {
    expect(failing({ ...goodConfig(), external_google_skip_nonce_check: false })).toEqual(["external_google_skip_nonce_check is true"]);
    const cfg = goodConfig();
    delete cfg.external_google_skip_nonce_check;
    expect(failing(cfg)).toEqual(["external_google_skip_nonce_check is true"]);
  });

  it("a provider the app enables but prod has off fails", () => {
    expect(failing({ ...goodConfig(), external_apple_enabled: false })).toEqual(["external_apple_enabled is true"]);
    expect(failing({ ...goodConfig(), external_google_enabled: false })).toEqual(["external_google_enabled is true"]);
  });

  it("a source disagreement fails the live check too", () => {
    const ids = { ...IDS, problems: ["planted"] };
    expect(checkAuthConfig(goodConfig(), ids).filter((r) => !r.ok).map((r) => r.detail)).toEqual(["planted"]);
  });
});

describe("the nightly runs it and fails on its outcome", () => {
  const drift = readFileSync(join(ROOT, ".github/workflows/db-drift-detect.yml"), "utf8");
  it("db-drift-detect runs the live check with the Management API secrets", () => {
    expect(drift).toMatch(
      /id: native_sign_in\n\s+continue-on-error: true\n[\s\S]*?SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}\n\s+SUPABASE_PROJECT_REF: \$\{\{ secrets\.SUPABASE_PROJECT_REF \}\}\n\s+run: node scripts\/check-native-sign-in-config\.mjs\n/,
    );
  });
  it("and turns the night red when it fails", () => {
    expect(drift).toContain("NATIVE_SIGN_IN: ${{ steps.native_sign_in.outcome }}");
    expect(drift).toMatch(/if \[ "\$\{NATIVE_SIGN_IN:-success\}" = "failure" \]; then[\s\S]*?failed=1/);
  });
});

describe("Apple + Google sign-in OFF for launch (Q1425)", () => {
  it("the real source has the switch off, and then only 'both providers disabled' is checked", () => {
    const ids = deriveSignInIds(SRC);
    expect(ids.socialEnabled).toBe(false);
    const ok = checkAuthConfig({ external_apple_enabled: false, external_google_enabled: false }, ids);
    expect(ok.map((r) => r.ok)).toEqual([true, true]);
    const bad = checkAuthConfig({ external_apple_enabled: true, external_google_enabled: false }, ids);
    expect(bad.filter((r) => !r.ok).map((r) => r.check)).toEqual(["external_apple_enabled is false"]);
  });
});
