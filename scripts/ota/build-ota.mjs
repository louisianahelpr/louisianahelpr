#!/usr/bin/env node
// Publishes a self-hosted OTA web bundle for the iOS app (docs/OTA_UPDATES.md).
//
//   node scripts/ota/build-ota.mjs --min-native-build <N> [--skip-build]
//
// 1. Builds the iOS web bundle (npm run build:ios) with OTA_BUNDLE = now (UTC
//    yyyymmddHHMMSS), unless --skip-build (then dist/ must be an iOS build; its
//    bundle number is read from OTA_BUNDLE, which must be the one it was built with).
// 2. Hashes every file in dist/ (sourcemaps and dist/ota excluded).
// 3. A file byte-identical to public/<same path> already ships on the website
//    at that path, so its url points there. Every other file is copied to
//    public/ota/ios/files/<sha256> (content-addressed) and its url points there.
//    Files no longer referenced are pruned.
// 4. Signs the manifest (ECDSA P-256 / SHA-256, IEEE P1363) with the release
//    key from OTA_SIGNING_KEY (PEM text) or OTA_SIGNING_KEY_FILE (path), and
//    refuses to write unless the signature verifies against the public key
//    baked into the app (src/lib/ota/otaManifest.ts).
// 5. Writes public/ota/ios/manifest.json. Land the public/ota/ios changes with
//    the normal train: the next prod deploy serves them, and installed apps
//    pick the bundle up on their next start and apply it on the start after.
//
// The website never loads anything under /ota/, so page speed is unaffected.

import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { otaCanonicalFiles, otaCanonicalPayload } from "../../src/lib/ota/otaCanonical.mjs";

export const OTA_ORIGIN = "https://www.louisianahelpr.com";

export function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** UTC yyyymmddHHMMSS for a Date. */
export function bundleNumberFor(date) {
  return Number(date.toISOString().replace(/[^0-9]/g, "").slice(0, 14));
}

/** Every file under dir, as bundle-relative POSIX paths, minus sourcemaps and ota/. */
export function listBundleFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, ent.name);
      const rel = relative(dir, abs).split(sep).join("/");
      if (ent.isDirectory()) {
        if (rel === "ota") continue;
        walk(abs);
      } else if (ent.isFile() && !rel.endsWith(".map")) {
        out.push(rel);
      }
    }
  };
  walk(dir);
  return out.sort();
}

/** Reads the baked-in public key from the app source, so the script can never
 *  sign with a key the app will reject. */
export function readAppPublicKey(root) {
  const src = readFileSync(join(root, "src/lib/ota/otaManifest.ts"), "utf8");
  const m = src.match(/OTA_PUBLIC_KEY_SPKI_B64\s*=\s*"([A-Za-z0-9+/=]+)"/);
  if (!m) throw new Error("OTA_PUBLIC_KEY_SPKI_B64 not found in src/lib/ota/otaManifest.ts");
  return createPublicKey({ key: Buffer.from(m[1], "base64"), format: "der", type: "spki" });
}

/**
 * Builds the manifest object from a built bundle. Pure apart from reading
 * files, so the tests can drive it on a fixture directory.
 */
export function buildManifest({ distDir, publicDir, bundle, minNativeBuild, privateKey, publicKey }) {
  if (!Number.isSafeInteger(bundle) || bundle <= 0) throw new Error(`bad bundle number ${bundle}`);
  if (!Number.isSafeInteger(minNativeBuild) || minNativeBuild <= 0) throw new Error(`bad --min-native-build ${minNativeBuild}`);
  const names = listBundleFiles(distDir);
  if (!names.includes("index.html")) throw new Error(`${distDir} has no index.html; build first`);
  const files = [];
  const hosted = new Map(); // sha256 -> absolute source path, for files/ copies
  for (const name of names) {
    const abs = join(distDir, name);
    const sha256 = sha256Hex(readFileSync(abs));
    const pub = join(publicDir, ...name.split("/"));
    let url;
    // Read once, no exists/stat check first (CodeQL js/file-system-race): a missing file or a directory just throws.
    let pubSha = null;
    try {
      pubSha = sha256Hex(readFileSync(pub));
    } catch {
      pubSha = null;
    }
    if (pubSha === sha256) {
      url = `${OTA_ORIGIN}/${name.split("/").map(encodeURIComponent).join("/")}`;
    } else {
      url = `${OTA_ORIGIN}/ota/ios/files/${sha256}`;
      hosted.set(sha256, abs);
    }
    files.push({ name, sha256, url });
  }
  const version = `ota-${bundle}`;
  const filesSha256 = sha256Hex(Buffer.from(otaCanonicalFiles(files), "utf8"));
  const unsigned = { platform: "ios", bundle, version, minNativeBuild, filesSha256 };
  const payload = Buffer.from(otaCanonicalPayload(unsigned), "utf8");
  const sig = sign("sha256", payload, { key: privateKey, dsaEncoding: "ieee-p1363" });
  if (!verify("sha256", payload, { key: publicKey, dsaEncoding: "ieee-p1363" }, sig)) {
    throw new Error("signature does not verify against the app's baked-in public key: wrong OTA_SIGNING_KEY");
  }
  return { manifest: { ...unsigned, files, sig: sig.toString("base64") }, hosted };
}

/** Copies hosted files into public/ota/ios/files and prunes the rest. */
export function writeRelease({ otaDir, manifest, hosted }) {
  const filesDir = join(otaDir, "files");
  mkdirSync(filesDir, { recursive: true });
  for (const [sha, abs] of hosted) {
    const dest = join(filesDir, sha);
    if (!existsSync(dest)) copyFileSync(abs, dest);
  }
  for (const f of readdirSync(filesDir)) {
    if (!hosted.has(f)) rmSync(join(filesDir, f));
  }
  writeFileSync(join(otaDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

function loadPrivateKey() {
  const pem = process.env.OTA_SIGNING_KEY
    ? process.env.OTA_SIGNING_KEY
    : process.env.OTA_SIGNING_KEY_FILE
      ? readFileSync(process.env.OTA_SIGNING_KEY_FILE, "utf8")
      : null;
  if (!pem) throw new Error("set OTA_SIGNING_KEY (PEM) or OTA_SIGNING_KEY_FILE (path); see docs/OTA_UPDATES.md");
  return createPrivateKey(pem);
}

function main(argv) {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const minNativeBuild = Number(arg("--min-native-build"));
  if (!Number.isSafeInteger(minNativeBuild) || minNativeBuild <= 0) {
    throw new Error("--min-native-build <N> is required: the lowest App Store build number (CFBundleVersion) that has every native plugin this bundle uses");
  }
  const privateKey = loadPrivateKey();
  const publicKey = readAppPublicKey(root);
  let bundle;
  if (argv.includes("--skip-build")) {
    bundle = Number(process.env.OTA_BUNDLE);
    if (!/^[1-9][0-9]{13}$/.test(process.env.OTA_BUNDLE ?? "")) throw new Error("--skip-build needs OTA_BUNDLE (the number dist/ was built with)");
  } else {
    bundle = bundleNumberFor(new Date());
    execFileSync("npm", ["run", "build:ios"], { cwd: root, stdio: "inherit", env: { ...process.env, OTA_BUNDLE: String(bundle) } });
  }
  // Same boot check the store build runs (ios-beta.yml): the bundle must carry
  // the prod Supabase ref and no other project's, or it could not boot.
  execFileSync("node", ["scripts/verify-bundle-env.mjs", "dist/assets"], { cwd: root, stdio: "inherit" });
  const { manifest, hosted } = buildManifest({
    distDir: join(root, "dist"),
    publicDir: join(root, "public"),
    bundle,
    minNativeBuild,
    privateKey,
    publicKey,
  });
  writeRelease({ otaDir: join(root, "public/ota/ios"), manifest, hosted });
  let hostedBytes = 0;
  for (const abs of hosted.values()) hostedBytes += statSync(abs).size;
  console.log(
    `OTA ${manifest.version}: ${manifest.files.length} files, ${hosted.size} hosted under /ota/ios/files ` +
      `(${(hostedBytes / 1e6).toFixed(1)} MB), the rest served from their website paths. minNativeBuild ${minNativeBuild}.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`build-ota: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
