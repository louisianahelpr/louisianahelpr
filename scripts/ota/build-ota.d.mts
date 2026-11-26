import type { KeyObject } from "node:crypto";

export declare const OTA_ORIGIN: string;
export declare function sha256Hex(buf: Buffer | Uint8Array): string;
export declare function bundleNumberFor(date: Date): number;
export declare function listBundleFiles(dir: string): string[];
export declare function readAppPublicKey(root: string): KeyObject;
export interface OtaReleaseFile {
  name: string;
  sha256: string;
  url: string;
}
export interface OtaReleaseManifest {
  platform: "ios";
  bundle: number;
  version: string;
  minNativeBuild: number;
  filesSha256: string;
  files: OtaReleaseFile[];
  sig: string;
}
export declare function buildManifest(opts: {
  distDir: string;
  publicDir: string;
  bundle: number;
  minNativeBuild: number;
  privateKey: KeyObject;
  publicKey: KeyObject;
}): { manifest: OtaReleaseManifest; hosted: Map<string, string> };
export declare function writeRelease(opts: {
  otaDir: string;
  manifest: OtaReleaseManifest;
  hosted: Map<string, string>;
}): void;
