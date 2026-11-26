// Shared by the app (src/lib/ota/otaManifest.ts) and the release script
// (scripts/ota/build-ota.mjs): the exact bytes the OTA signature covers.
// Plain .mjs so the Node release script can import it without a TS step;
// types live in otaCanonical.d.mts. Changing either function breaks every
// manifest already published, so bump OTA_SIG_DOMAIN when you do.

export const OTA_SIG_DOMAIN = "louisianahelpr-ota-v1";

/**
 * The file list as one string: one "name<TAB>sha256<TAB>url" line per file,
 * sorted by name. Its SHA-256 is what the signature covers (filesSha256).
 * @param {ReadonlyArray<{ name: string, sha256: string, url: string }>} files
 * @returns {string}
 */
export function otaCanonicalFiles(files) {
  return [...files]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((f) => `${f.name}\t${f.sha256}\t${f.url}`)
    .join("\n");
}

/**
 * @param {{ platform: string, bundle: number, version: string, filesSha256: string, minNativeBuild: number }} m
 * @returns {string}
 */
export function otaCanonicalPayload(m) {
  return [
    OTA_SIG_DOMAIN,
    m.platform,
    String(m.bundle),
    m.version,
    m.filesSha256,
    String(m.minNativeBuild),
  ].join("\n");
}
