/** Types for scripts/go-links.mjs (read by src/test/goLinks.test.ts). */
import type { GoLink } from "../src/lib/goLinks.mjs";
type MutableMap = Record<string, GoLink>;
export function mapJson(map: Readonly<MutableMap>): string;
export function mapModule(map: Readonly<MutableMap>): string;
export function refusal(slug: string, url: string, map?: Readonly<MutableMap>): string | null;
export function slugsFromPicks(
  picks: ReadonlyArray<{ brand?: string; name?: string; href?: string }>,
  map: Readonly<MutableMap>,
): { map: MutableMap; added: number };
