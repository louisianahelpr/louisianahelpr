/// <reference types="vite/client" />

declare module '*.webp' {
  const src: string;
  export default src;
}

// Build-time identity constants injected by vite.config.ts `define`.
declare const __APP_COMMIT__: string;
declare const __APP_BUILT_AT__: string;
declare const __APP_COMMIT_FULL__: string;
/** OTA bundle number of this build (yyyymmddHHMMSS); see src/lib/ota/otaManifest.ts. */
declare const __OTA_BUNDLE__: string;
