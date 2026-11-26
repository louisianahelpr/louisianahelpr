/**
 * Self-hosted OTA updates (docs/OTA_UPDATES.md): the release script signs a
 * manifest and the app refuses anything that is not signed by the baked-in key,
 * not on our origin, not newer, or meant for a newer native build.
 *
 * End to end: scripts/ota/build-ota.mjs builds the manifest from a fixture
 * bundle with a throwaway key, and src/lib/ota/otaManifest.ts verifies it with
 * Node's WebCrypto (the same API the app uses in WKWebView).
 *
 * @mutate src/lib/ota/otaManifest.ts | if (listHash !== m.filesSha256) return false; | if (false) return false;
 * @mutate src/lib/ota/otaManifest.ts | if (!subtle) return false; | if (!subtle) return true;
 * @mutate src/lib/ota/otaManifest.ts | if (native < m.minNativeBuild) return { install: false, reason: "native-too-old" }; | if (false) return { install: false, reason: "native-too-old" };
 * @mutate src/lib/ota/otaManifest.ts | if (!(m.bundle > ctx.runningBundle)) return { install: false, reason: "not-newer" }; | if (!(m.bundle >= ctx.runningBundle)) return { install: false, reason: "not-newer" };
 * @mutate src/lib/ota/otaManifest.ts | u.origin === OTA_ORIGIN && | true &&
 * @mutate src/lib/ota/otaManifest.ts | !name.split("/").some((seg) => seg === "" \|\| seg === "." \|\| seg === "..") | true
 * @mutate scripts/ota/build-ota.mjs | if (rel === "ota") continue; | if (rel === "nope") continue;
 * @mutate src/main.tsx |   if (isNativeIos) {\n    void backgroundImport(() => import("./lib/ota/otaUpdater") |   if (true) {\n    void backgroundImport(() => import("./lib/ota/otaUpdater")
 * @mutate src/main.tsx | import { initNative, hideSplash, isNativePlatform, isNativeIos } from "./lib/nativeInit"; | import { initNative, hideSplash, isNativePlatform, isNativeIos } from "./lib/nativeInit";\nimport "./lib/ota/otaUpdater";
 * @mutate capacitor.config.ts |       statsUrl: '', |       statsUrl: 'https://plugin.capgo.app/stats',
 * @mutate scripts/ota/build-ota.mjs | throw new Error("signature does not verify against the app's baked-in public key: wrong OTA_SIGNING_KEY"); | void 0;
 */
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, webcrypto, createPublicKey } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import ts from "typescript";
import { join } from "node:path";
import {
  OTA_PUBLIC_KEY_SPKI_B64,
  decideOtaUpdate,
  isAllowedFileUrl,
  parseOtaManifest,
  parseRunningBundle,
  toPluginManifest,
  verifyOtaManifest,
  type OtaManifest,
} from "@/lib/ota/otaManifest";
import { buildManifest, writeRelease, listBundleFiles, readAppPublicKey, bundleNumberFor } from "../../scripts/ota/build-ota.mjs";

const subtle = webcrypto.subtle as unknown as SubtleCrypto;

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spkiB64 = (publicKey.export({ format: "der", type: "spki" }) as Buffer).toString("base64");
  return { privateKey, publicKey, spkiB64 };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ota-test-"));
  const dist = join(root, "dist");
  const pub = join(root, "public");
  mkdirSync(join(dist, "assets"), { recursive: true });
  mkdirSync(join(dist, "gift-guides"), { recursive: true });
  mkdirSync(join(dist, "ota", "ios"), { recursive: true });
  mkdirSync(join(pub, "gift-guides"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<html>ios</html>");
  writeFileSync(join(dist, "assets", "index-abc.js"), "console.log('ios')");
  writeFileSync(join(dist, "assets", "index-abc.js.map"), "{}");
  writeFileSync(join(dist, "ota", "ios", "manifest.json"), "{}");
  writeFileSync(join(dist, "gift-guides", "a b.webp"), "same-bytes");
  writeFileSync(join(pub, "gift-guides", "a b.webp"), "same-bytes");
  writeFileSync(join(dist, "robots.txt"), "ios-copy");
  writeFileSync(join(pub, "robots.txt"), "web-copy-differs");
  return { root, dist, pub };
}

function signed(opts: { bundle?: number; minNativeBuild?: number } = {}) {
  const k = keyPair();
  const f = fixture();
  const { manifest, hosted } = buildManifest({
    distDir: f.dist,
    publicDir: f.pub,
    bundle: opts.bundle ?? 20261125220000,
    minNativeBuild: opts.minNativeBuild ?? 7602,
    privateKey: k.privateKey,
    publicKey: k.publicKey,
  });
  return { k, f, manifest: manifest as OtaManifest, hosted };
}

const clone = (m: OtaManifest): OtaManifest => JSON.parse(JSON.stringify(m));

describe("OTA release script -> app verifier", () => {
  it("a manifest the script signs parses and verifies in the app", async () => {
    const { k, manifest } = signed();
    const parsed = parseOtaManifest(clone(manifest));
    expect(parsed).not.toBeNull();
    expect(await verifyOtaManifest(parsed!, subtle, k.spkiB64)).toBe(true);
  });

  it("lists every bundle file except sourcemaps and the ota/ release folder", () => {
    const { f, manifest } = signed();
    const names = manifest.files.map((x) => x.name);
    expect(names).toEqual(["assets/index-abc.js", "gift-guides/a b.webp", "index.html", "robots.txt"]);
    expect(listBundleFiles(f.dist)).toEqual(names);
    expect(names.length).toBeGreaterThan(3);
  });

  it("points website-identical files at their website path and hosts the rest content-addressed", () => {
    const { manifest, hosted } = signed();
    const byName = Object.fromEntries(manifest.files.map((x) => [x.name, x]));
    expect(byName["gift-guides/a b.webp"].url).toBe("https://www.louisianahelpr.com/gift-guides/a%20b.webp");
    for (const n of ["index.html", "assets/index-abc.js", "robots.txt"]) {
      expect(byName[n].url).toBe(`https://www.louisianahelpr.com/ota/ios/files/${byName[n].sha256}`);
      expect(hosted.has(byName[n].sha256)).toBe(true);
    }
    expect(hosted.size).toBe(3);
  });

  it("writeRelease copies hosted files, prunes stale ones and writes manifest.json", () => {
    const { f, manifest, hosted } = signed();
    const otaDir = join(f.root, "public", "ota", "ios");
    mkdirSync(join(otaDir, "files"), { recursive: true });
    writeFileSync(join(otaDir, "files", "0".repeat(64)), "stale");
    writeRelease({ otaDir, manifest, hosted });
    expect(readdirSync(join(otaDir, "files")).sort()).toEqual([...hosted.keys()].sort());
    expect(existsSync(join(otaDir, "files", "0".repeat(64)))).toBe(false);
    expect(JSON.parse(readFileSync(join(otaDir, "manifest.json"), "utf8")).sig).toBe(manifest.sig);
  });

  it("refuses to sign with a key the app would reject", () => {
    const signer = keyPair();
    const other = keyPair();
    const f = fixture();
    expect(() =>
      buildManifest({ distDir: f.dist, publicDir: f.pub, bundle: 20261125220000, minNativeBuild: 7602, privateKey: signer.privateKey, publicKey: other.publicKey }),
    ).toThrow(/does not verify/);
  });

  it("the script reads the same public key the app has baked in", () => {
    const fromScript = readAppPublicKey(process.cwd());
    const fromApp = createPublicKey({ key: Buffer.from(OTA_PUBLIC_KEY_SPKI_B64, "base64"), format: "der", type: "spki" });
    expect(fromScript.export({ format: "pem", type: "spki" })).toBe(fromApp.export({ format: "pem", type: "spki" }));
    expect(bundleNumberFor(new Date("2026-11-25T22:05:09.123Z"))).toBe(20261125220509);
  });
});

describe("OTA integrity: the app fails closed", () => {
  it("rejects a changed file hash (list no longer matches filesSha256)", async () => {
    const { k, manifest } = signed();
    const m = clone(manifest);
    m.files[0].sha256 = "f".repeat(64);
    expect(await verifyOtaManifest(parseOtaManifest(m)!, subtle, k.spkiB64)).toBe(false);
  });

  it("rejects a changed bundle number, version or minNativeBuild (signature)", async () => {
    const { k, manifest } = signed();
    for (const patch of [{ bundle: manifest.bundle + 1 }, { version: "ota-1" }, { minNativeBuild: 1 }]) {
      const m = { ...clone(manifest), ...patch };
      expect(await verifyOtaManifest(parseOtaManifest(m)!, subtle, k.spkiB64)).toBe(false);
    }
  });

  it("rejects a manifest signed by another key, and fails closed without WebCrypto", async () => {
    const { manifest } = signed();
    const stranger = keyPair();
    expect(await verifyOtaManifest(parseOtaManifest(clone(manifest))!, subtle, stranger.spkiB64)).toBe(false);
    // The real baked-in key did not sign this throwaway manifest either.
    expect(await verifyOtaManifest(parseOtaManifest(clone(manifest))!, subtle)).toBe(false);
    expect(await verifyOtaManifest(parseOtaManifest(clone(manifest))!, undefined, stranger.spkiB64)).toBe(false);
  });

  it("parse rejects foreign or insecure urls, unsafe paths, duplicates and a missing index.html", () => {
    const { manifest } = signed();
    const bad: Array<(m: OtaManifest) => void> = [
      (m) => (m.files[0].url = "http://www.louisianahelpr.com/ota/ios/files/x"),
      (m) => (m.files[0].url = "https://evil.example.com/x.js"),
      (m) => (m.files[0].url = "https://www.louisianahelpr.com.evil.com/x.js"),
      (m) => (m.files[0].url = "https://user:pw@www.louisianahelpr.com/x.js"),
      (m) => (m.files[0].name = "../escape.js"),
      (m) => (m.files[0].name = "/abs.js"),
      (m) => (m.files[0].name = "assets//x.js"),
      (m) => (m.files[1].name = m.files[0].name),
      (m) => (m.files = m.files.filter((x) => x.name !== "index.html")),
      (m) => (m.files[0].sha256 = "ABC"),
      (m) => (m.filesSha256 = "nothex"),
      (m) => ((m as { platform: string }).platform = "android"),
      (m) => (m.bundle = -1),
      (m) => (m.minNativeBuild = 1.5),
    ];
    expect(parseOtaManifest(clone(manifest))).not.toBeNull();
    for (const mutate of bad) {
      const m = clone(manifest);
      mutate(m);
      expect(parseOtaManifest(m)).toBeNull();
    }
    expect(parseOtaManifest(null)).toBeNull();
    expect(parseOtaManifest("x")).toBeNull();
    expect(isAllowedFileUrl("https://www.louisianahelpr.com/ota/ios/files/abc")).toBe(true);
    expect(isAllowedFileUrl("not a url")).toBe(false);
  });

  it("maps files to the plugin's per-file manifest entries", () => {
    const { manifest } = signed();
    const entries = toPluginManifest(manifest);
    expect(entries).toHaveLength(manifest.files.length);
    expect(entries[0]).toEqual({ file_name: manifest.files[0].name, file_hash: manifest.files[0].sha256, download_url: manifest.files[0].url });
  });
});

describe("OTA install decision", () => {
  const base = signed({ bundle: 20261125220000, minNativeBuild: 7602 }).manifest;

  it("installs a newer bundle on a new-enough binary", () => {
    expect(decideOtaUpdate(base, { runningBundle: 20261120000000, nativeBuild: "7602" })).toEqual({ install: true });
    expect(decideOtaUpdate(base, { runningBundle: 20261120000000, nativeBuild: 9000 })).toEqual({ install: true });
  });

  it("never applies a bundle that needs newer native code", () => {
    expect(decideOtaUpdate(base, { runningBundle: 1, nativeBuild: "7601" })).toEqual({ install: false, reason: "native-too-old" });
  });

  it("never replaces an equal or newer running bundle (no downgrade after a store update)", () => {
    expect(decideOtaUpdate(base, { runningBundle: base.bundle, nativeBuild: "7602" })).toEqual({ install: false, reason: "not-newer" });
    expect(decideOtaUpdate(base, { runningBundle: base.bundle + 1, nativeBuild: "7602" })).toEqual({ install: false, reason: "not-newer" });
  });

  it("skips a version that already failed, and an unreadable native build", () => {
    expect(decideOtaUpdate(base, { runningBundle: 1, nativeBuild: "7602", failedVersions: [base.version] })).toEqual({ install: false, reason: "already-failed" });
    expect(decideOtaUpdate(base, { runningBundle: 1, nativeBuild: "" })).toEqual({ install: false, reason: "bad-native-build" });
  });

  it("a build with no bundle stamp never updates itself", () => {
    expect(parseRunningBundle("20261125220000")).toBe(20261125220000);
    expect(parseRunningBundle("")).toBe(Number.POSITIVE_INFINITY);
    expect(decideOtaUpdate(base, { runningBundle: parseRunningBundle("garbage"), nativeBuild: "7602" }).install).toBe(false);
  });
});

describe("OTA stays off the website and off Capgo's cloud", () => {
  it("main.tsx loads the updater only lazily, only inside if (isNativeIos)", () => {
    // One file read by path, not a directory walk (noSrcDirectoryWalksInTests flags a quoted src path).
    const sf = ts.createSourceFile("main.tsx", readFileSync(join(__dirname, "..", "main.tsx"), "utf8"), ts.ScriptTarget.Latest, true);
    const statics: string[] = [];
    const lazyGuards: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) statics.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg) && arg.text.includes("/ota/")) {
          let p: ts.Node | undefined = node.parent;
          while (p && !ts.isIfStatement(p)) p = p.parent;
          lazyGuards.push(p && ts.isIfStatement(p) ? p.expression.getText(sf) : "<none>");
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(statics.length).toBeGreaterThan(5);
    expect(statics.filter((m) => m.includes("/ota/") || m.includes("capacitor-updater"))).toEqual([]);
    expect(lazyGuards).toEqual(["isNativeIos"]);
  });

  it("capacitor.config.ts runs the plugin in manual mode with every Capgo URL blanked", () => {
    const src = readFileSync(join(process.cwd(), "capacitor.config.ts"), "utf8");
    const start = src.indexOf("CapacitorUpdater: {");
    const block = src.slice(start, src.indexOf("}", start));
    expect(block.length).toBeGreaterThan(50);
    for (const line of ["autoUpdate: false,", "updateUrl: '',", "statsUrl: '',", "channelUrl: '',", "resetWhenUpdate: true,", "autoDeleteFailed: true,"]) {
      expect(block).toContain(line);
    }
    expect(block).not.toMatch(/publicKey|capgo\.app/);
  });
});
