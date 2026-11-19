/** Types for scripts/indexnow-ping.mjs (src/test/indexNowPing.test.ts). */
export const INDEXNOW_KEY: string;
export const INDEXNOW_HOST: string;
export const INDEXNOW_ENDPOINT: string;
export function sitemapUrls(xml: string): string[];
export function indexNowBodies(urls: string[]): { host: string; key: string; keyLocation: string; urlList: string[] }[];
