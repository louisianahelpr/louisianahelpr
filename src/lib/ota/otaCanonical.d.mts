export declare const OTA_SIG_DOMAIN: string;
export declare function otaCanonicalFiles(
  files: ReadonlyArray<{ name: string; sha256: string; url: string }>,
): string;
export declare function otaCanonicalPayload(m: {
  platform: string;
  bundle: number;
  version: string;
  filesSha256: string;
  minNativeBuild: number;
}): string;
